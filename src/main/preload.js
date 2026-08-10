'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  invoke: [
    'auth:register','auth:login','auth:logout','auth:currentUser','auth:listUsers',
    'auth:getProfile','auth:updateProfile','auth:changePassword',
    'auth:rememberLogin','auth:clearRemembered','auth:tryRememberedLogin',
    'posts:create','posts:update','posts:delete','posts:get','posts:list','posts:search','posts:filterByStatus',
    'dashboard:stats','dashboard:activity','dashboard:siteStatus',
    'settings:get','settings:set','settings:getTheme','settings:setTheme','settings:blogConfig',
    'deploy:getConfig','deploy:setConfig','deploy:deploy','deploy:history','deploy:latest',
    'scanner:scan',
    'themes:list','themes:activate','themes:install',
'plugins:list','plugins:install','plugins:uninstall',
'plugins:previewRecipe','plugins:applyRecipe','config:read','config:write',
    'env:guide','env:detect','env:installHexo',
    'preview:start','preview:stop','preview:status','preview:openBrowser','preview:setF11Hook',
    'backup:exportJson','backup:exportBak','backup:restore',
    'markdown:render',
    'notice:manual',
    'files:openText'

  ],
  on: [
    'preview:f11'
  ]
};

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (!CHANNELS.invoke.includes(channel)) return Promise.reject(new Error('forbidden channel: ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    if (!CHANNELS.on.includes(channel)) return;
    // 仅白名单通道；剥掉 ipc 事件参数，仅把载荷传给回调。
    ipcRenderer.on(channel, (_event, ...args) => cb(...args));
  }
});
