'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'qiniu.config.json';

function defaultConfig() {
    return {
        accessKey: '',
        secretKey: '',
        bucket: '',
        zone: 'z0',
        keyPrefix: '',
        cdnVersion: '',
        cdnDomain: '',
        uploadOnBuild: false,
        remoteBuildDir: 'build/wechatgame',
    };
}

function getConfigPath(extensionRoot) {
    return path.join(extensionRoot, CONFIG_FILE);
}

function loadConfigFile(extensionRoot) {
    const configPath = getConfigPath(extensionRoot);
    if (!fs.existsSync(configPath)) {
        return defaultConfig();
    }
    try {
        return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    } catch (err) {
        throw new Error(`读取 ${CONFIG_FILE} 失败: ${err.message}`);
    }
}

function normalizePathPart(value) {
    return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function normalizeCdnVersion(value) {
    const version = normalizePathPart(value);
    if (!version) return '';
    if (!/^[A-Za-z0-9._-]+$/.test(version)) {
        throw new Error('CDN 版本号只能包含英文、数字、点、下划线和中划线');
    }
    return version.replace(/\./g, '_');
}

function resolveVersionedKeyPrefix(keyPrefix, cdnVersion) {
    const prefix = normalizePathPart(keyPrefix);
    const version = normalizeCdnVersion(cdnVersion);
    if (!version) {
        throw new Error('CDN 版本号不能为空，请在七牛插件中填写版本号');
    }
    return prefix ? `${version}/${prefix}` : version;
}

function resolveVersionedCdnServer(cdnDomain, cdnVersion) {
    const domain = String(cdnDomain || '').trim().replace(/\/+$/, '');
    if (!domain) {
        throw new Error('CDN 域名不能为空，请在七牛插件中填写 CDN 域名');
    }
    const version = normalizeCdnVersion(cdnVersion);
    if (!version) {
        throw new Error('CDN 版本号不能为空，请在七牛插件中填写版本号');
    }
    return `${domain}/${version}/`;
}

function resolveBuildKeyPrefix(pkgOptions, fileConfig) {
    const fromFile = normalizePathPart(fileConfig.keyPrefix);
    const fromPkg = normalizePathPart(pkgOptions.qiniuKeyPrefix);
    // qiniu.config.json 为显式保存的配置，优先于可能过期的构建 profile
    return fromFile || fromPkg;
}

function resolveBuildCdnVersion(pkgOptions, fileConfig) {
    const fromFile = normalizeCdnVersion(fileConfig.cdnVersion);
    const fromPkg = normalizeCdnVersion(pkgOptions.qiniuCdnVersion);
    return fromFile || fromPkg;
}

function syncBuildProfile(projectRoot, fields) {
    const profilePath = path.join(projectRoot, 'profiles/v2/packages/qiniu-upload.json');
    if (!fs.existsSync(profilePath)) {
        return;
    }

    try {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        if (!profile.builder) {
            profile.builder = {};
        }
        if (!profile.builder.options) {
            profile.builder.options = {};
        }

        const patch = {};
        if (fields.uploadOnBuild !== undefined) {
            patch.uploadToQiniu = !!fields.uploadOnBuild;
        }
        if (fields.keyPrefix !== undefined) {
            patch.qiniuKeyPrefix = normalizePathPart(fields.keyPrefix);
        }
        if (fields.cdnVersion !== undefined) {
            patch.qiniuCdnVersion = normalizeCdnVersion(fields.cdnVersion);
        }
        if (Object.keys(patch).length === 0) {
            return;
        }

        for (const platformOptions of Object.values(profile.builder.options)) {
            Object.assign(platformOptions, patch);
        }
        const taskMap = profile.builder.taskOptionsMap || {};
        for (const taskOptions of Object.values(taskMap)) {
            Object.assign(taskOptions, patch);
        }

        fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    } catch (err) {
        console.warn(`[qiniu-upload] 同步构建 profile 失败: ${err.message}`);
    }
}

function saveConfigFile(extensionRoot, config, projectRoot) {
    const current = loadConfigFile(extensionRoot);
    const nextSecret = String(config.secretKey || '').trim();
    const merged = {
        ...current,
        accessKey: String(config.accessKey || '').trim(),
        secretKey: nextSecret || current.secretKey,
        bucket: String(config.bucket || '').trim(),
        zone: String(config.zone || 'z0').trim() || 'z0',
        keyPrefix: normalizePathPart(config.keyPrefix),
        cdnVersion: normalizeCdnVersion(config.cdnVersion),
        cdnDomain: String(config.cdnDomain || '').trim().replace(/\/+$/, ''),
        uploadOnBuild: !!config.uploadOnBuild,
        remoteBuildDir: String(config.remoteBuildDir || 'build/wechatgame').trim()
            || 'build/wechatgame',
    };

    fs.writeFileSync(
        getConfigPath(extensionRoot),
        `${JSON.stringify(merged, null, 2)}\n`,
        'utf8',
    );

    const resolvedProjectRoot = projectRoot || path.resolve(extensionRoot, '..', '..');
    syncBuildProfile(resolvedProjectRoot, {
        uploadOnBuild: merged.uploadOnBuild,
        keyPrefix: merged.keyPrefix,
        cdnVersion: merged.cdnVersion,
    });
    return merged;
}

function resolveRemoteDir(projectPath, extensionRoot, remoteBuildDir) {
    const cfg = loadConfigFile(extensionRoot);
    const rel = remoteBuildDir || cfg.remoteBuildDir || 'build/wechatgame';
    const base = path.isAbsolute(rel) ? rel : path.join(projectPath, rel);
    return path.join(base, 'remote');
}

function assertCredentials(config, configPath) {
    if (!config.accessKey || !config.secretKey || !config.bucket) {
        throw new Error(
            '七牛配置不完整：请在「七牛云上传」面板填写 AccessKey / SecretKey / Bucket 并保存，'
            + `配置文件：${configPath}`,
        );
    }
    if (config.accessKey === config.secretKey) {
        throw new Error(
            'AccessKey 与 SecretKey 不能相同，请从七牛控制台分别复制 AK 和 SK 后重新保存。'
            + `配置文件：${configPath}`,
        );
    }
}

function resolveCredentials(extensionRoot, override = {}) {
    const fileConfig = loadConfigFile(extensionRoot);
    const configPath = getConfigPath(extensionRoot);
    const config = {
        accessKey: override.accessKey || process.env.QINIU_AK || fileConfig.accessKey,
        secretKey: override.secretKey || process.env.QINIU_SK || fileConfig.secretKey,
        bucket: override.bucket || process.env.QINIU_BUCKET || fileConfig.bucket,
        zone: override.zone || process.env.QINIU_ZONE || fileConfig.zone || 'z0',
    };

    assertCredentials(config, configPath);
    return config;
}

/**
 * 构建 worker 中 __dirname 可能不可靠，优先从构建产物目录反推项目根目录。
 */
function resolveExtensionRoot(options, result) {
    const candidates = [];

    if (options && options.project) {
        candidates.push(path.join(options.project, 'extensions/qiniu-upload'));
    }
    if (result && result.dest) {
        const projectFromDest = path.resolve(result.dest, '..', '..');
        candidates.push(path.join(projectFromDest, 'extensions/qiniu-upload'));
    }
    candidates.push(path.resolve(__dirname, '..'));

    for (const root of candidates) {
        if (fs.existsSync(path.join(root, 'package.json'))
            && fs.existsSync(path.join(root, CONFIG_FILE))) {
            return root;
        }
    }

    for (const root of candidates) {
        if (fs.existsSync(path.join(root, 'package.json'))) {
            return root;
        }
    }

    return candidates[candidates.length - 1];
}

function maskSecret(value) {
    if (!value) return '(empty)';
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function resolveProjectRoot(options, result) {
    if (options && options.project) {
        return options.project;
    }
    if (result && result.dest) {
        return path.resolve(result.dest, '..', '..');
    }
    return path.resolve(__dirname, '..', '..', '..');
}

function loadBuildPackageOptions(options, result) {
    const PACKAGE_NAME = 'qiniu-upload';
    const fromBuild = (options.packages && options.packages[PACKAGE_NAME]) || {};
    if (Object.keys(fromBuild).length > 0) {
        return fromBuild;
    }

    const projectRoot = resolveProjectRoot(options, result);
    const profilePath = path.join(projectRoot, 'profiles/v2/packages/qiniu-upload.json');
    if (!fs.existsSync(profilePath)) {
        return {};
    }

    try {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        const platform = options.platform || 'wechatgame';
        const fromPlatform = profile.builder?.options?.[platform];
        if (fromPlatform && Object.keys(fromPlatform).length > 0) {
            return fromPlatform;
        }
        const taskMap = profile.builder?.taskOptionsMap || {};
        const firstTask = Object.values(taskMap)[0];
        return firstTask || {};
    } catch (err) {
        console.warn(`[qiniu-upload] 读取构建 profile 失败: ${err.message}`);
        return {};
    }
}

function describeCredentialSource(extensionRoot) {
    const configPath = getConfigPath(extensionRoot);
    const fileConfig = loadConfigFile(extensionRoot);
    return {
        configPath,
        accessKey: maskSecret(process.env.QINIU_AK || fileConfig.accessKey),
        secretKey: maskSecret(process.env.QINIU_SK || fileConfig.secretKey),
        bucket: process.env.QINIU_BUCKET || fileConfig.bucket || '(empty)',
        zone: process.env.QINIU_ZONE || fileConfig.zone || 'z0',
    };
}

module.exports = {
    CONFIG_FILE,
    defaultConfig,
    normalizeCdnVersion,
    resolveVersionedCdnServer,
    resolveVersionedKeyPrefix,
    resolveBuildKeyPrefix,
    resolveBuildCdnVersion,
    syncBuildProfile,
    loadConfigFile,
    saveConfigFile,
    resolveRemoteDir,
    resolveCredentials,
    resolveExtensionRoot,
    assertCredentials,
    describeCredentialSource,
    resolveProjectRoot,
    loadBuildPackageOptions,
};
