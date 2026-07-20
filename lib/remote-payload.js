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
 * 通用检查：remote/ 目录存在且有实际文件即可上传，不限定具体 bundle
 * @param {string} remoteDir
 * @returns {{ ok: boolean, reason?: string, fileCount?: number }}
 */
function validateRemotePayload(remoteDir) {
    if (!fs.existsSync(remoteDir)) {
        return { ok: false, reason: 'remote 目录不存在' };
    }

    const files = walkFiles(remoteDir);
    if (!files.length) {
        return { ok: false, reason: 'remote 目录为空' };
    }

    const nonEmptyFiles = files.filter((f) => !isEmptyMainConfig(f));
    if (!nonEmptyFiles.length) {
        return {
            ok: false,
            reason: 'remote 仅有空的 main 配置。请关闭「主包远程」并为需要的 Bundle 勾选「配置为远程包」后重新构建',
        };
    }

    return { ok: true, fileCount: files.length };
}

module.exports = {
    walkFiles,
    validateRemotePayload,
};
