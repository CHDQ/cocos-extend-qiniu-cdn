'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const qiniu = require('qiniu');

const { resolveCredentials } = require('./config-store');

const ZONE_MAP = {
    z0: qiniu.zone.Zone_z0,
    z1: qiniu.zone.Zone_z1,
    z2: qiniu.zone.Zone_z2,
    na0: qiniu.zone.Zone_na0,
    as0: qiniu.zone.Zone_as0,
};

const PROBE_KEY = '_cocos_qiniu_probe/connection.test';

function createMac(config) {
    return new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
}

function createUploadToken(config, key) {
    const mac = createMac(config);
    const putPolicy = new qiniu.rs.PutPolicy({
        scope: key ? `${config.bucket}:${key}` : config.bucket,
    });
    return putPolicy.uploadToken(mac);
}

function createFormUploader(zone) {
    const qiniuConfig = new qiniu.conf.Config();
    qiniuConfig.zone = ZONE_MAP[zone] || qiniu.zone.Zone_z0;
    qiniuConfig.useCdnDomain = true;
    return new qiniu.form_up.FormUploader(qiniuConfig);
}

function putFile(formUploader, uploadToken, key, localFile) {
    return new Promise((resolve, reject) => {
        formUploader.putFile(uploadToken, key, localFile, null, (err, body, info) => {
            if (err) {
                reject(err);
                return;
            }
            if (info.statusCode === 200) {
                resolve({ key, hash: body.hash });
                return;
            }
            reject(new Error(`HTTP ${info.statusCode} ${JSON.stringify(body)}`));
        });
    });
}

/**
 * 与构建钩子相同的路径：真实上传探针文件，避免“本地能生成 token”的假阳性。
 * @param {string} extensionRoot
 * @param {{ accessKey?: string, secretKey?: string, bucket?: string, zone?: string }} override
 */
async function testConnection(extensionRoot, override = {}) {
    const config = resolveCredentials(extensionRoot, override);
    const uploadToken = createUploadToken(config, PROBE_KEY);
    const formUploader = createFormUploader(config.zone);

    const tmpFile = path.join(os.tmpdir(), `qiniu-upload-probe-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, `cocos-qiniu-probe ${new Date().toISOString()}\n`, 'utf8');

    try {
        await putFile(formUploader, uploadToken, PROBE_KEY, tmpFile);
    } catch (err) {
        const message = String(err.message || err);
        if (message.includes('BadToken') || message.includes('401')) {
            throw new Error(
                '七牛拒绝了上传凭证（401 BadToken）。请确认 AccessKey / SecretKey 来自同一账号、'
                + 'Bucket 名称正确，且区域与存储空间一致后重新保存配置。',
            );
        }
        throw new Error(`七牛上传探针失败: ${message}`);
    } finally {
        try {
            fs.unlinkSync(tmpFile);
        } catch (_) {
            // ignore
        }
    }

    return {
        ok: true,
        bucket: config.bucket,
        zone: config.zone,
        probeKey: PROBE_KEY,
    };
}

module.exports = {
    ZONE_MAP,
    createMac,
    createUploadToken,
    createFormUploader,
    putFile,
    testConnection,
};
