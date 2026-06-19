'use strict';

const fs = require('fs');
const path = require('path');

const { resolveCredentials } = require('./config-store');
const { createUploadToken, createFormUploader, putFile } = require('./qiniu-client');

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

function normalizePrefix(prefix) {
    if (!prefix) return '';
    return String(prefix).replace(/^\/+|\/+$/g, '');
}

function toPosixRelative(root, file) {
    return path.relative(root, file).split(path.sep).join('/');
}

/**
 * @param {string} remoteDir 构建产物中的 remote 目录
 * @param {string} extensionRoot 扩展根目录（读取 qiniu.config.json）
 * @param {{ keyPrefix?: string, log?: (msg: string) => void, credentials?: object }} opts
 */
function resolveUploadRoot(remoteDir, onlyBundle) {
    if (!onlyBundle) {
        return remoteDir;
    }
    const bundleDir = path.join(remoteDir, onlyBundle);
    if (!fs.existsSync(bundleDir)) {
        throw new Error(`remote/${onlyBundle} 不存在，无法上传`);
    }
    return bundleDir;
}

async function uploadRemoteDir(remoteDir, extensionRoot, opts = {}) {
    const log = opts.log || console.log;
    if (!fs.existsSync(remoteDir)) {
        return { uploaded: 0, skipped: true, reason: 'remote 目录不存在' };
    }

    const config = resolveCredentials(extensionRoot, opts.credentials || {});
    const prefix = normalizePrefix(opts.keyPrefix);
    const uploadRoot = resolveUploadRoot(remoteDir, opts.onlyBundle);
    const files = walkFiles(uploadRoot);
    if (!files.length) {
        return { uploaded: 0, skipped: true, reason: 'remote 目录为空' };
    }

    const formUploader = createFormUploader(config.zone);

    let uploaded = 0;
    for (const file of files) {
        const rel = toPosixRelative(uploadRoot, file);
        const bundlePrefix = opts.onlyBundle ? `${opts.onlyBundle}/` : '';
        const key = prefix ? `${prefix}/${bundlePrefix}${rel}` : `${bundlePrefix}${rel}`;
        const uploadToken = createUploadToken(config, key);
        await putFile(formUploader, uploadToken, key, file);
        uploaded += 1;
        log(`[qiniu-upload] ${uploaded}/${files.length} ${key}`);
    }

    return { uploaded, total: files.length, bucket: config.bucket, keyPrefix: prefix };
}

module.exports = {
    uploadRemoteDir,
};
