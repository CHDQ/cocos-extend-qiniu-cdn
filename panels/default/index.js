'use strict';

const Path = require('path');
const Fs = require('fs');

const {
    loadConfigFile,
    saveConfigFile,
    resolveRemoteDir,
    resolveVersionedKeyPrefix,
} = require('../../lib/config-store');
const { testConnection } = require('../../lib/qiniu-client');
const { uploadRemoteDir } = require('../../lib/upload-remote');

const PACKAGE_NAME = 'qiniu-upload';
const EXTENSION_ROOT = Path.resolve(__dirname, '../..');

function projectPath() {
    return (typeof Editor !== 'undefined' && Editor.Project && Editor.Project.path)
        ? Editor.Project.path
        : '';
}

function setStatus(panel, text, isError) {
    if (!panel.$ || !panel.$.status) return;
    panel.$.status.value = text;
    panel.$.status.style.color = isError ? '#e74c3c' : '#7f8c8d';
}

function readForm(panel) {
    return {
        accessKey: panel.$.accessKey.value || '',
        secretKey: panel.$.secretKey.value || '',
        bucket: panel.$.bucket.value || '',
        zone: panel.$.zone.value || 'z0',
        keyPrefix: panel.$.keyPrefix.value || '',
        cdnVersion: panel.$.cdnVersion.value || '',
        cdnDomain: panel.$.cdnDomain.value || '',
        uploadOnBuild: !!panel.$.uploadOnBuild.value,
        remoteBuildDir: panel.$.remoteBuildDir.value || 'build/wechatgame',
    };
}

function fillForm(panel, config) {
    panel.$.accessKey.value = config.accessKey || '';
    panel.$.secretKey.value = config.secretKey || '';
    panel.$.bucket.value = config.bucket || '';
    panel.$.zone.value = config.zone || 'z0';
    panel.$.keyPrefix.value = config.keyPrefix || '';
    panel.$.cdnVersion.value = config.cdnVersion || '';
    panel.$.cdnDomain.value = config.cdnDomain || '';
    panel.$.uploadOnBuild.value = !!config.uploadOnBuild;
    panel.$.remoteBuildDir.value = config.remoteBuildDir || 'build/wechatgame';
    updateRemotePreview(panel);
}

function updateRemotePreview(panel) {
    const proj = projectPath();
    const rel = panel.$.remoteBuildDir.value || 'build/wechatgame';
    const remoteDir = proj
        ? resolveRemoteDir(proj, EXTENSION_ROOT, rel)
        : Path.join(rel, 'remote');
    const exists = proj && Fs.existsSync(remoteDir);
    panel.$.remotePreview.value = exists
        ? `✓ ${remoteDir}`
        : `○ ${remoteDir}（尚未生成，需先构建微信小游戏）`;
    panel.$.remotePreview.style.color = exists ? '#27ae60' : '#95a5a6';
}

module.exports = Editor.Panel.define({
    template: `
<div class="qiniu-panel">
    <header class="header">
        <h2>七牛云资源上传</h2>
        <p class="hint">配置账号后，构建微信小游戏时可自动上传 remote/，也可在此手动上传。</p>
    </header>

    <ui-section header="账号配置" expand>
        <ui-prop>
            <ui-label slot="label" value="AccessKey"></ui-label>
            <ui-input slot="content" class="access-key" placeholder="七牛 AccessKey"></ui-input>
        </ui-prop>
        <ui-prop>
            <ui-label slot="label" value="SecretKey"></ui-label>
            <ui-input slot="content" class="secret-key" type="password" placeholder="七牛 SecretKey"></ui-input>
        </ui-prop>
        <ui-prop>
            <ui-label slot="label" value="Bucket"></ui-label>
            <ui-input slot="content" class="bucket" placeholder="存储空间名称"></ui-input>
        </ui-prop>
        <ui-prop>
            <ui-label slot="label" value="区域"></ui-label>
            <ui-select slot="content" class="zone">
                <option value="z0">华东 z0</option>
                <option value="z1">华北 z1</option>
                <option value="z2">华南 z2</option>
                <option value="na0">北美 na0</option>
                <option value="as0">东南亚 as0</option>
            </ui-select>
        </ui-prop>
    </ui-section>

    <ui-section header="上传设置" expand>
        <ui-prop>
            <ui-label slot="label" value="Key 前缀"></ui-label>
            <ui-input slot="content" class="key-prefix" placeholder="dream-abyss"></ui-input>
        </ui-prop>
        <ui-prop>
            <ui-label slot="label" value="版本号"></ui-label>
            <ui-input slot="content" class="cdn-version" placeholder="v20260619-001"></ui-input>
        </ui-prop>
        <ui-prop>
            <ui-label slot="label" value="CDN 域名"></ui-label>
            <ui-input slot="content" class="cdn-domain" placeholder="https://das.game.chdq-cloud.top"></ui-input>
        </ui-prop>
        <ui-label class="hint-block" value="同一个版本号会上传到同一个文件夹：版本号/Key 前缀/resources/...；资源服务器地址 = CDN 域名/版本号/。"></ui-label>
        <ui-prop>
            <ui-label slot="label" value="构建后自动上传"></ui-label>
            <ui-checkbox slot="content" class="upload-on-build"></ui-checkbox>
        </ui-prop>
        <ui-prop>
            <ui-label slot="label" value="构建输出目录"></ui-label>
            <ui-input slot="content" class="remote-build-dir" placeholder="build/wechatgame"></ui-input>
        </ui-prop>
        <ui-prop>
            <ui-label slot="label" value="remote 路径"></ui-label>
            <ui-label slot="content" class="remote-preview"></ui-label>
        </ui-prop>
    </ui-section>

    <div class="actions">
        <ui-button class="btn-save" type="primary">保存配置</ui-button>
        <ui-button class="btn-test">测试连接</ui-button>
        <ui-button class="btn-upload">立即上传 remote</ui-button>
    </div>

    <footer class="footer">
        <ui-label class="status" value="就绪"></ui-label>
    </footer>
</div>
    `,
    style: `
.qiniu-panel {
    padding: 12px 16px 20px;
    box-sizing: border-box;
    height: 100%;
    overflow: auto;
}
.header h2 {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 600;
}
.hint {
    margin: 0 0 12px;
    font-size: 12px;
    color: #7f8c8d;
    line-height: 1.5;
}
.hint-block {
    display: block;
    margin: 0 0 10px 12px;
    font-size: 11px;
    color: #95a5a6;
    line-height: 1.45;
}
.actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 16px 0 12px;
}
.footer {
    border-top: 1px solid rgba(128, 128, 128, 0.25);
    padding-top: 10px;
}
.status {
    font-size: 12px;
    color: #7f8c8d;
    white-space: pre-wrap;
    word-break: break-all;
}
.remote-preview {
    font-size: 11px;
    line-height: 1.4;
}
    `,
    $: {
        accessKey: '.access-key',
        secretKey: '.secret-key',
        bucket: '.bucket',
        zone: '.zone',
        keyPrefix: '.key-prefix',
        cdnVersion: '.cdn-version',
        cdnDomain: '.cdn-domain',
        uploadOnBuild: '.upload-on-build',
        remoteBuildDir: '.remote-build-dir',
        remotePreview: '.remote-preview',
        btnSave: '.btn-save',
        btnTest: '.btn-test',
        btnUpload: '.btn-upload',
        status: '.status',
    },
    methods: {
        async saveConfig() {
            try {
                const config = readForm(this);
                saveConfigFile(EXTENSION_ROOT, config, projectPath() || undefined);
                setStatus(this, '配置已保存到 qiniu.config.json', false);
            } catch (err) {
                setStatus(this, `保存失败: ${err.message}`, true);
            }
        },
        async testConfig() {
            try {
                saveConfigFile(EXTENSION_ROOT, readForm(this), projectPath() || undefined);
                const form = readForm(this);
                setStatus(this, '正在向七牛上传探针文件验证凭证...', false);
                const result = await testConnection(EXTENSION_ROOT, form);
                setStatus(
                    this,
                    `连接成功（已真实上传探针）· Bucket: ${result.bucket} · 区域: ${result.zone}`,
                    false,
                );
            } catch (err) {
                setStatus(this, `连接失败: ${err.message}`, true);
            }
        },
        async uploadNow() {
            const proj = projectPath();
            if (!proj) {
                setStatus(this, '无法获取项目路径', true);
                return;
            }

            try {
                saveConfigFile(EXTENSION_ROOT, readForm(this), projectPath() || undefined);
                const form = readForm(this);
                const remoteDir = resolveRemoteDir(proj, EXTENSION_ROOT, form.remoteBuildDir);
                const versionedKeyPrefix = resolveVersionedKeyPrefix(form.keyPrefix, form.cdnVersion);
                setStatus(this, `正在上传 ${remoteDir} ...`, false);

                const summary = await uploadRemoteDir(remoteDir, EXTENSION_ROOT, {
                    keyPrefix: versionedKeyPrefix,
                    log: (msg) => console.log(msg),
                });

                if (summary.skipped) {
                    setStatus(this, `未上传: ${summary.reason}`, true);
                    return;
                }

                setStatus(
                    this,
                    `上传完成: ${summary.uploaded}/${summary.total} 个文件 → ${summary.bucket}`,
                    false,
                );
            } catch (err) {
                setStatus(this, `上传失败: ${err.message}`, true);
            }
        },
        refreshRemotePreview() {
            updateRemotePreview(this);
        },
    },
    ready() {
        try {
            fillForm(this, loadConfigFile(EXTENSION_ROOT));
            setStatus(this, '已加载本地配置', false);
        } catch (err) {
            setStatus(this, `加载配置失败: ${err.message}`, true);
        }

        const bind = (el, handler) => {
            if (!el) return;
            el.addEventListener('confirm', handler);
            el.addEventListener('click', handler);
        };

        bind(this.$.btnSave, () => this.saveConfig());
        bind(this.$.btnTest, () => this.testConfig());
        bind(this.$.btnUpload, () => this.uploadNow());
        this.$.remoteBuildDir.addEventListener('change', () => this.refreshRemotePreview());
        this.$.remoteBuildDir.addEventListener('confirm', () => this.refreshRemotePreview());
    },
});
