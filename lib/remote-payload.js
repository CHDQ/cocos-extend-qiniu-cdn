'use strict';

const fs = require('fs');
const path = require('path');

function walkFiles(dir) {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            out.push(...walkFiles(full));
        } else if (stat.isFile()) {
            out.push(full);
        }
    }
    return out;
}

function isEmptyMainConfig(filePath) {
    if (!/\/main\/config[^/]*\.json$/i.test(filePath.replace(/\\/g, '/'))) {
        return false;
    }
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return !Array.isArray(data.uuids) || data.uuids.length === 0;
    } catch (_) {
        return false;
    }
}

/**
 * @param {string} remoteDir
 * @returns {{ ok: boolean, reason?: string, fileCount?: number, resourcesCount?: number }}
 */
function validateRemotePayload(remoteDir) {
    if (!fs.existsSync(remoteDir)) {
        return { ok: false, reason: 'remote 目录不存在' };
    }

    const files = walkFiles(remoteDir);
    if (!files.length) {
        return { ok: false, reason: 'remote 目录为空' };
    }

    const resourcesCount = files.filter((f) => f.includes(`${path.sep}resources${path.sep}`)).length;
    const nonEmptyFiles = files.filter((f) => !isEmptyMainConfig(f));

    if (!nonEmptyFiles.length) {
        return {
            ok: false,
            reason: 'remote 仅有空的 main 配置。请关闭「主包远程」，并为 resources Bundle 勾选「配置为远程包」后重新构建',
        };
    }

    if (!resourcesCount) {
        return {
            ok: false,
            reason: 'remote 中没有 resources 资源。请在 Bundle 配置里为 resources 勾选微信小游戏「配置为远程包」，并填写资源服务器地址后重新构建',
        };
    }

    return { ok: true, fileCount: files.length, resourcesCount };
}

module.exports = {
    walkFiles,
    validateRemotePayload,
};
