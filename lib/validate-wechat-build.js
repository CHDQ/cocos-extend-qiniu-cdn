'use strict';

const fs = require('fs');
const path = require('path');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findSettingsFile(dest) {
    const srcDir = path.join(dest, 'src');
    if (!fs.existsSync(srcDir)) {
        return null;
    }
    const files = fs.readdirSync(srcDir).filter((name) => /^settings\..*\.json$/i.test(name));
    return files.length ? path.join(srcDir, files[0]) : null;
}

function listRemoteBundleNames(dest) {
    const remoteDir = path.join(dest, 'remote');
    if (!fs.existsSync(remoteDir)) {
        return [];
    }
    return fs.readdirSync(remoteDir).filter((name) => {
        const full = path.join(remoteDir, name);
        return fs.statSync(full).isDirectory();
    });
}

function isEmptyMainRemoteConfig(dest) {
    const mainDir = path.join(dest, 'remote', 'main');
    if (!fs.existsSync(mainDir)) {
        return false;
    }
    const configs = fs.readdirSync(mainDir).filter((name) => /^config\..*\.json$/i.test(name));
    for (const name of configs) {
        try {
            const data = readJson(path.join(mainDir, name));
            if (!Array.isArray(data.uuids) || data.uuids.length === 0) {
                return true;
            }
        } catch (_) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string} dest 微信构建输出目录
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateWechatBuild(dest) {
    const errors = [];
    const warnings = [];

    if (!dest || !fs.existsSync(dest)) {
        return { ok: false, errors: ['构建输出目录不存在'], warnings };
    }

    const settingsPath = findSettingsFile(dest);
    if (!settingsPath) {
        errors.push('缺少 src/settings.*.json');
    } else {
        const settings = readJson(settingsPath);
        const assets = settings.assets || {};
        const remoteBundles = assets.remoteBundles || [];
        const subpackages = assets.subpackages || [];

        if (remoteBundles.includes('main') || remoteBundles.includes('internal')) {
            errors.push(
                `settings 中 remoteBundles=${JSON.stringify(remoteBundles)}。`
                + ' 仅 resources 应远程，请关闭「主包远程」并取消 internal 远程。',
            );
        }
        if (!remoteBundles.includes('resources')) {
            errors.push('settings.remoteBundles 未包含 resources，CDN 资源包不会生效。');
        }
        if (!subpackages.length) {
            errors.push('settings.subpackages 为空。主包/internal 应走微信分包，不应全部远程。');
        }
    }

    const remoteBundlesOnDisk = listRemoteBundleNames(dest);
    const unexpectedRemote = remoteBundlesOnDisk.filter((name) => name !== 'resources');
    if (unexpectedRemote.length) {
        errors.push(`remote/ 目录包含不应远程的 Bundle: ${unexpectedRemote.join(', ')}`);
    }
    if (!remoteBundlesOnDisk.includes('resources')) {
        errors.push('remote/resources 不存在，resources 未进远程包。');
    }
    if (isEmptyMainRemoteConfig(dest)) {
        errors.push('remote/main/config.*.json 为空（uuids: []）。这是「主包远程」开着的典型坏产物。');
    }

    const subpackagesDir = path.join(dest, 'subpackages');
    if (!fs.existsSync(subpackagesDir)) {
        errors.push('subpackages/ 不存在。internal/main 未生成微信分包。');
    } else {
        for (const name of ['internal', 'main']) {
            if (!fs.existsSync(path.join(subpackagesDir, name))) {
                errors.push(`subpackages/${name}/ 不存在。`);
            }
        }
    }

    const gameJsonPath = path.join(dest, 'game.json');
    if (fs.existsSync(gameJsonPath)) {
        const gameJson = readJson(gameJsonPath);
        if (!Array.isArray(gameJson.subpackages) || !gameJson.subpackages.length) {
            errors.push('game.json 未声明 subpackages。微信端不会按需加载 internal/main。');
        }
        // 分离引擎会在 game.json 中声明 cocos 插件，这是微信发布包规避引擎 JS 单文件过大的推荐形态。
    }

    const hashedEntryFiles = [
        'application.js',
        path.join('src', 'system.bundle.js'),
        path.join('src', 'polyfills.bundle.js'),
        path.join('src', 'import-map.js'),
        path.join('cocos-js', 'cc.js'),
    ];
    const missingStableEntries = hashedEntryFiles.filter((rel) => !fs.existsSync(path.join(dest, rel)));
    const hasHashedApplication = fs.readdirSync(dest).some((name) => /^application\.[a-f0-9]+\.js$/i.test(name));
    if (missingStableEntries.length && hasHashedApplication) {
        warnings.push(
            'MD5 Cache 已开启，入口文件带 hash（如 application.xxxxx.js）。'
            + ' 微信开发者工具预编译会报 application.js / system.bundle.js ENOENT，建议开发期关闭 MD5 Cache。',
        );
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
    };
}

module.exports = {
    validateWechatBuild,
};
