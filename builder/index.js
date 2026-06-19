'use strict';

const PACKAGE_NAME = 'qiniu-upload';

exports.load = async function load() {
    console.log(`[${PACKAGE_NAME}] 构建扩展已加载`);
};

exports.unload = async function unload() {
    console.log(`[${PACKAGE_NAME}] 构建扩展已卸载`);
};

exports.configs = {
    wechatgame: {
        hooks: './hooks',
        panel: './panel',
        options: {
            uploadToQiniu: {
                label: '构建后上传七牛',
                default: false,
            },
            qiniuKeyPrefix: {
                label: '七牛 Key 前缀',
                default: 'remote',
            },
            qiniuCdnVersion: {
                label: '七牛版本号',
                default: '',
            },
        },
    },
};
