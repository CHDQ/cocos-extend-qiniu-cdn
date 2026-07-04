'use strict';

const fs = require('fs');
const path = require('path');
const {
    loadConfigFile,
    resolveExtensionRoot,
    describeCredentialSource,
    loadBuildPackageOptions,
    resolveBuildKeyPrefix,
    resolveBuildCdnVersion,
    resolveVersionedKeyPrefix,
    resolveVersionedCdnServer,
} = require('../lib/config-store');
const { uploadRemoteDir } = require('../lib/upload-remote');
const { refreshCdnCacheAfterUpload } = require('../lib/cdn-cache-refresh');
const { validateRemotePayload } = require('../lib/remote-payload');
const { validateWechatBuild } = require('../lib/validate-wechat-build');
const {
    patchWechatProjectConfig,
    patchWechatLocalFontPreload,
    patchWechatResourceServer,
    stripRemoteDir,
    assertGameJsExists,
} = require('../lib/wechat-project-fix');

const PACKAGE_NAME = 'qiniu-upload';

exports.throwError = true;

exports.onAfterBuild = async function onAfterBuild(options, result) {
    const extensionRoot = resolveExtensionRoot(options, result);
    const pkgOptions = loadBuildPackageOptions(options, result);
    const fileConfig = loadConfigFile(extensionRoot);
    const shouldUpload = pkgOptions.uploadToQiniu ?? fileConfig.uploadOnBuild;

    if (!result || !result.dest) {
        throw new Error(`[${PACKAGE_NAME}] 无法获取构建输出目录 result.dest`);
    }

    assertGameJsExists(result.dest);

    if (patchWechatProjectConfig(result.dest)) {
        console.log(`[${PACKAGE_NAME}] 已修正 project.config.json（首包 game.js + 忽略 remote/）`);
    }
    if (patchWechatLocalFontPreload(result.dest)) {
        console.log(`[${PACKAGE_NAME}] 已将 localfont 固定为微信本地预加载包`);
    }

    let keyPrefix = resolveBuildKeyPrefix(pkgOptions, fileConfig);
    if (!keyPrefix) {
        keyPrefix = 'remote';
    }
    const cdnVersion = resolveBuildCdnVersion(pkgOptions, fileConfig);
    const versionedCdnServer = resolveVersionedCdnServer(fileConfig.cdnDomain, cdnVersion);
    if (patchWechatResourceServer(result.dest, versionedCdnServer)) {
        console.log(`[${PACKAGE_NAME}] 已修正远程资源服务器地址: ${versionedCdnServer}`);
    }

    if (!shouldUpload) {
        console.log(`[${PACKAGE_NAME}] 未开启「构建后上传七牛」，跳过 CDN 上传（资源服务器已按版本号 ${cdnVersion} 写入）`);
        return;
    }

    const buildCheck = validateWechatBuild(result.dest);
    for (const warning of buildCheck.warnings) {
        console.warn(`[${PACKAGE_NAME}] 构建检查警告: ${warning}`);
    }
    if (!buildCheck.ok) {
        const detail = buildCheck.errors.map((item, index) => `${index + 1}. ${item}`).join('\n');
        console.warn(
            `[${PACKAGE_NAME}] 微信构建产物存在配置问题（仍会上传 remote/resources）：\n${detail}`,
        );
    }

    const remoteDir = path.join(result.dest, 'remote');
    const versionedKeyPrefix = resolveVersionedKeyPrefix(keyPrefix, cdnVersion);

    const remoteBundleNames = fs.readdirSync(remoteDir).filter((name) => {
        const full = path.join(remoteDir, name);
        return fs.statSync(full).isDirectory();
    });
    const unexpectedRemote = remoteBundleNames.filter((n) => n !== 'resources');
    if (unexpectedRemote.length) {
        console.warn(
            `[${PACKAGE_NAME}] remote/ 含非 resources 目录: ${unexpectedRemote.join(', ')}。`
            + ' internal/main 不应远程，请关闭「主包远程」后重新构建，否则运行时会去 CDN 拉 internal 导致 404。',
        );
    }
    const credInfo = describeCredentialSource(extensionRoot);
    const payloadCheck = validateRemotePayload(remoteDir);

    console.log(`[${PACKAGE_NAME}] 开始上传 remote → 七牛`);
    console.log(`[${PACKAGE_NAME}] 扩展目录: ${extensionRoot}`);
    console.log(`[${PACKAGE_NAME}] 配置文件: ${credInfo.configPath}`);
    console.log(`[${PACKAGE_NAME}] 凭证摘要: AK=${credInfo.accessKey} SK=${credInfo.secretKey} bucket=${credInfo.bucket} zone=${credInfo.zone}`);
    console.log(`[${PACKAGE_NAME}] 本地目录: ${remoteDir}`);
    if (keyPrefix) {
        console.log(`[${PACKAGE_NAME}] Key 前缀: ${keyPrefix}`);
    }
    console.log(`[${PACKAGE_NAME}] CDN 版本号: ${cdnVersion}`);
    console.log(`[${PACKAGE_NAME}] 实际上传前缀: ${versionedKeyPrefix}`);
    console.log(`[${PACKAGE_NAME}] 资源服务器地址: ${versionedCdnServer}`);

    if (!payloadCheck.ok) {
        throw new Error(`[${PACKAGE_NAME}] 无法上传: ${payloadCheck.reason}`);
    }

    console.log(
        `[${PACKAGE_NAME}] 待上传: ${payloadCheck.fileCount} 个文件`
        + `（resources: ${payloadCheck.resourcesCount}）`,
    );

    const summary = await uploadRemoteDir(remoteDir, extensionRoot, {
        keyPrefix: versionedKeyPrefix,
        onlyBundle: 'resources',
        log: (msg) => console.log(msg),
    });

    if (fileConfig.refreshCdnAfterUpload !== false) {
        try {
            await refreshCdnCacheAfterUpload(extensionRoot, {
                cdnDomain: fileConfig.cdnDomain,
                uploadedKeys: summary.uploadedKeys,
                versionedCdnServer,
                log: (msg) => console.log(msg),
            });
        } catch (err) {
            console.warn(`[${PACKAGE_NAME}] CDN 缓存刷新失败（文件已上传成功）: ${err.message}`);
        }
    }

    if (stripRemoteDir(result.dest)) {
        console.log(`[${PACKAGE_NAME}] 已移除构建目录中的 remote/（静态资源仅保留在七牛 CDN）`);
    }

    const stamp = {
        uploadedAt: new Date().toISOString(),
        dest: result.dest,
        bucket: summary.bucket,
        keyPrefix: summary.keyPrefix,
        cdnVersion,
        uploaded: summary.uploaded,
        total: summary.total,
        refreshedCdn: fileConfig.refreshCdnAfterUpload !== false,
    };
    fs.writeFileSync(
        path.join(extensionRoot, '.qiniu-upload-last.json'),
        `${JSON.stringify(stamp, null, 2)}\n`,
        'utf8',
    );

    console.log(
        `[${PACKAGE_NAME}] 完成: ${summary.uploaded}/${summary.total} 个文件 → bucket=${summary.bucket}`,
    );
};
