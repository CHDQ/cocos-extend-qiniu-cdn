'use strict';

const PACKAGE_NAME = 'qiniu-upload';

exports.load = async function load() {
    console.log(`[${PACKAGE_NAME}] 扩展已加载`);
};

exports.unload = async function unload() {
    console.log(`[${PACKAGE_NAME}] 扩展已卸载`);
};

exports.methods = {
    openPanel() {
        Editor.Panel.open(`${PACKAGE_NAME}.default`);
    },
};
