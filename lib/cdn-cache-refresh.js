'use strict';

const qiniu = require('qiniu');

const { resolveCredentials } = require('./config-store');

const URL_BATCH_SIZE = 100;
const DIR_BATCH_SIZE = 10;

function normalizeCdnDomain(cdnDomain) {
    return String(cdnDomain || '').trim().replace(/\/+$/, '');
}

function buildCdnUrl(cdnDomain, key) {
    const domain = normalizeCdnDomain(cdnDomain);
    if (!domain) {
        throw new Error('CDN 域名不能为空，无法刷新 CDN 缓存');
    }
    const path = String(key || '').replace(/^\/+/, '');
    return `${domain}/${path}`;
}

function buildCdnUrls(cdnDomain, keys) {
    return (keys || []).map((key) => buildCdnUrl(cdnDomain, key));
}

function createCdnManager(extensionRoot, credentials) {
    const config = resolveCredentials(extensionRoot, credentials || {});
    const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
    return new qiniu.cdn.CdnManager(mac);
}

function isCdnRefreshSuccess(body, statusCode) {
    if (statusCode !== 200) {
        return false;
    }
    if (body.code === 200) {
        return true;
    }
    if (body.code !== undefined && body.code !== 200) {
        return false;
    }
    return !body.error || body.error === 'success';
}

function cdnRefreshFailureMessage(body, statusCode) {
    if (body.error && body.error !== 'success') {
        return body.error;
    }
    if (body.code !== undefined && body.code !== 200) {
        return body.error || `code ${body.code}`;
    }
    return `HTTP ${statusCode}`;
}

function callCdnRefresh(cdnManager, urls, dirs) {
    return new Promise((resolve, reject) => {
        cdnManager.refreshUrlsAndDirs(urls, dirs, (err, respBody, respInfo) => {
            if (err) {
                reject(err);
                return;
            }
            const statusCode = respInfo?.statusCode ?? 0;
            const body = respBody && typeof respBody === 'object' ? respBody : {};
            if (!isCdnRefreshSuccess(body, statusCode)) {
                reject(new Error(`CDN 刷新失败: ${cdnRefreshFailureMessage(body, statusCode)}`));
                return;
            }
            resolve({
                requestId: body.requestId || '',
                taskIds: body.taskIds || {},
                invalidUrls: body.invalidUrls || [],
                invalidDirs: body.invalidDirs || [],
            });
        });
    });
}

async function refreshCdnUrls(cdnManager, urls, log) {
    let refreshed = 0;
    for (let i = 0; i < urls.length; i += URL_BATCH_SIZE) {
        const batch = urls.slice(i, i + URL_BATCH_SIZE);
        const result = await callCdnRefresh(cdnManager, batch, null);
        refreshed += batch.length;
        log(
            `[qiniu-upload] CDN 文件刷新 ${refreshed}/${urls.length}`
            + (result.requestId ? ` requestId=${result.requestId}` : ''),
        );
        if (result.invalidUrls?.length) {
            log(`[qiniu-upload] CDN 无效 URL: ${result.invalidUrls.join(', ')}`);
        }
    }
    return { mode: 'urls', refreshed, total: urls.length };
}

async function refreshCdnDirs(cdnManager, dirs, log) {
    let refreshed = 0;
    for (let i = 0; i < dirs.length; i += DIR_BATCH_SIZE) {
        const batch = dirs.slice(i, i + DIR_BATCH_SIZE);
        const result = await callCdnRefresh(cdnManager, null, batch);
        refreshed += batch.length;
        log(
            `[qiniu-upload] CDN 目录刷新 ${refreshed}/${dirs.length}`
            + (result.requestId ? ` requestId=${result.requestId}` : ''),
        );
        if (result.invalidDirs?.length) {
            throw new Error(`CDN 目录刷新无效: ${result.invalidDirs.join(', ')}`);
        }
    }
    return { mode: 'dirs', refreshed, total: dirs.length, dirs };
}

/**
 * 上传完成后刷新 CDN 缓存。优先尝试版本目录刷新，失败则回退到逐文件 URL 刷新。
 * @param {string} extensionRoot
 * @param {{
 *   cdnDomain: string,
 *   uploadedKeys?: string[],
 *   versionedCdnServer?: string,
 *   credentials?: object,
 *   log?: (msg: string) => void,
 * }} opts
 */
async function refreshCdnCacheAfterUpload(extensionRoot, opts = {}) {
    const log = opts.log || console.log;
    const uploadedKeys = opts.uploadedKeys || [];
    if (!uploadedKeys.length) {
        return { skipped: true, reason: '无上传文件，跳过 CDN 刷新' };
    }

    const cdnDomain = normalizeCdnDomain(opts.cdnDomain);
    if (!cdnDomain) {
        return { skipped: true, reason: '未配置 CDN 域名，跳过 CDN 刷新' };
    }

    const cdnManager = createCdnManager(extensionRoot, opts.credentials);
    const versionDir = String(opts.versionedCdnServer || '').trim();
    const dirs = versionDir ? [versionDir.endsWith('/') ? versionDir : `${versionDir}/`] : [];

    if (dirs.length) {
        try {
            const dirResult = await refreshCdnDirs(cdnManager, dirs, log);
            log('[qiniu-upload] CDN 目录缓存刷新已提交（全网生效约 10 分钟）');
            return dirResult;
        } catch (err) {
            log(`[qiniu-upload] CDN 目录刷新失败，回退逐文件刷新: ${err.message}`);
        }
    }

    const urls = buildCdnUrls(cdnDomain, uploadedKeys);
    const urlResult = await refreshCdnUrls(cdnManager, urls, log);
    log('[qiniu-upload] CDN 文件缓存刷新已提交（全网生效约 10 分钟）');
    return urlResult;
}

module.exports = {
    URL_BATCH_SIZE,
    buildCdnUrl,
    buildCdnUrls,
    isCdnRefreshSuccess,
    cdnRefreshFailureMessage,
    refreshCdnCacheAfterUpload,
    refreshCdnDirs,
    refreshCdnUrls,
};
