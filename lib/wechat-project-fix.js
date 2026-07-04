'use strict';

const fs = require('fs');
const path = require('path');

function ensurePackIgnore(config, folderName) {
    config.packOptions = config.packOptions || {};
    const ignore = Array.isArray(config.packOptions.ignore) ? config.packOptions.ignore : [];
    const exists = ignore.some((item) => item && item.type === 'folder' && item.value === folderName);
    if (!exists) {
        ignore.push({ type: 'folder', value: folderName });
    }
    config.packOptions.ignore = ignore;
}

/**
 * 微信开发者工具对 md5 文件名、隔离上下文兼容较差，构建后修正 project.config.json。
 * @param {string} buildDest
 */
function patchWechatProjectConfig(buildDest) {
    const configPath = path.join(buildDest, 'project.config.json');
    if (!fs.existsSync(configPath)) {
        return false;
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    config.compileType = 'game';
    config.miniprogramRoot = config.miniprogramRoot || './';
    config.setting = config.setting || {};
    config.setting.useIsolateContext = false;
    config.setting.enhance = false;
    config.setting.es6 = true;
    config.setting.minified = true;
    // 开发阶段允许访问未配置到微信后台的 CDN 域名
    config.setting.urlCheck = false;

    const remoteDir = path.join(buildDest, 'remote');
    if (fs.existsSync(remoteDir)) {
        // 静态资源已上 CDN 后，发布到微信时不再打包 remote/（避免首包虚胖、误传 CDN 目录）
        ensurePackIgnore(config, 'remote');
    }

    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 4)}\n`, 'utf8');
    return true;
}

/**
 * 七牛上传成功后删除构建目录中的 remote/，确保微信首包只保留 game.js 等本地入口。
 * @param {string} buildDest
 */
function stripRemoteDir(buildDest) {
    const remoteDir = path.join(buildDest, 'remote');
    if (!fs.existsSync(remoteDir)) {
        return false;
    }
    fs.rmSync(remoteDir, { recursive: true, force: true });
    return true;
}

function assertGameJsExists(buildDest) {
    const gameJs = path.join(buildDest, 'game.js');
    if (!fs.existsSync(gameJs)) {
        throw new Error(
            `构建产物缺少首包入口 game.js：${gameJs}。请确认发布平台为微信小游戏且构建成功。`,
        );
    }
}

function findSettingsFiles(buildDest) {
    const srcDir = path.join(buildDest, 'src');
    if (!fs.existsSync(srcDir)) {
        return [];
    }
    return fs.readdirSync(srcDir)
        .filter((name) => /^settings(\..*)?\.json$/i.test(name))
        .map((name) => path.join(srcDir, name));
}

/**
 * 版本化 CDN 上传后，运行时资源服务器也必须指向同一个版本目录。
 * @param {string} buildDest
 * @param {string} serverUrl 形如 https://cdn.example.com/v1/（勿含 remote/，引擎会自动拼接）
 */
function patchWechatResourceServer(buildDest, serverUrl) {
    const settingsFiles = findSettingsFiles(buildDest);
    let changed = false;
    for (const file of settingsFiles) {
        const raw = fs.readFileSync(file, 'utf8');
        const settings = JSON.parse(raw);
        settings.assets = settings.assets || {};
        if (settings.assets.server === serverUrl) {
            continue;
        }
        settings.assets.server = serverUrl;
        fs.writeFileSync(file, `${JSON.stringify(settings)}\n`, 'utf8');
        changed = true;
    }
    return changed;
}

function preloadBundleName(entry) {
    if (typeof entry === 'string') {
        return entry;
    }
    if (entry && typeof entry === 'object') {
        return entry.bundle;
    }
    return '';
}

function normalizePreloadBundles(preloadBundles) {
    const seen = new Set();
    const out = [];
    for (const entry of Array.isArray(preloadBundles) ? preloadBundles : []) {
        const name = preloadBundleName(entry);
        if (!name || seen.has(name)) {
            continue;
        }
        seen.add(name);
        out.push(typeof entry === 'string' ? { bundle: entry } : entry);
    }
    return out;
}

function patchWechatLocalFontPreload(buildDest) {
    const settingsFiles = findSettingsFiles(buildDest);
    let anyChanged = false;
    for (const file of settingsFiles) {
        let changed = false;
        const raw = fs.readFileSync(file, 'utf8');
        const settings = JSON.parse(raw);
        settings.assets = settings.assets || {};
        const oldPreloadBundles = settings.assets.preloadBundles;
        const preloadBundles = normalizePreloadBundles(oldPreloadBundles);
        if (JSON.stringify(oldPreloadBundles || []) !== JSON.stringify(preloadBundles)) {
            changed = true;
        }
        if (!preloadBundles.some((entry) => preloadBundleName(entry) === 'localfont')) {
            preloadBundles.push({ bundle: 'localfont' });
            changed = true;
        }
        const remoteBundles = Array.isArray(settings.assets.remoteBundles)
            ? settings.assets.remoteBundles
            : [];
        if (remoteBundles.includes('localfont')) {
            settings.assets.remoteBundles = remoteBundles.filter((name) => name !== 'localfont');
            changed = true;
        } else if (!Array.isArray(settings.assets.remoteBundles)) {
            settings.assets.remoteBundles = remoteBundles;
        }
        settings.assets.preloadBundles = preloadBundles;
        if (changed) {
            fs.writeFileSync(file, `${JSON.stringify(settings)}\n`, 'utf8');
            anyChanged = true;
        }
    }
    return anyChanged;
}

function patchWechatCdnRemoteReferences(buildDest, serverUrl) {
    patchWechatLocalFontPreload(buildDest);
    return patchWechatResourceServer(buildDest, serverUrl);
}

function validateWechatCdnReferences(buildDest) {
    const settingsFiles = findSettingsFiles(buildDest);
    const errors = [];
    if (!settingsFiles.length) {
        errors.push(`缺少 settings.json: ${path.join(buildDest, 'src')}`);
    }
    for (const file of settingsFiles) {
        const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
        const assets = settings.assets || {};
        if (!assets.server || !/^https?:\/\//.test(assets.server)) {
            errors.push(`${file} 缺少有效的 assets.server CDN 地址`);
        }
        if (!Array.isArray(assets.remoteBundles) || !assets.remoteBundles.includes('resources')) {
            errors.push(`${file} 的 remoteBundles 必须包含 resources`);
        }
        if (Array.isArray(assets.remoteBundles) && assets.remoteBundles.includes('localfont')) {
            errors.push(`${file} 不应将 localfont 放入 remoteBundles`);
        }
        const preloadBundles = Array.isArray(assets.preloadBundles) ? assets.preloadBundles : [];
        const hasLocalFontPreload = preloadBundles.some(
            (entry) => preloadBundleName(entry) === 'localfont',
        );
        const hasInvalidPreloadEntry = preloadBundles.some((entry) => typeof entry === 'string');
        if (!hasLocalFontPreload) {
            errors.push(`${file} 必须将 localfont 放入 preloadBundles`);
        }
        if (hasInvalidPreloadEntry) {
            errors.push(`${file} 的 preloadBundles 必须使用 { bundle: name } 对象格式`);
        }
    }
    return { ok: errors.length === 0, errors };
}

module.exports = {
    patchWechatProjectConfig,
    patchWechatLocalFontPreload,
    patchWechatCdnRemoteReferences,
    validateWechatCdnReferences,
    patchWechatResourceServer,
    stripRemoteDir,
    assertGameJsExists,
};
