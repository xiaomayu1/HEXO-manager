'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  invoke: [
    'auth:register','auth:login','auth:logout','auth:currentUser','auth:listUsers',
    'auth:getProfile','auth:updateProfile','auth:changePassword',
    'auth:rememberLogin','auth:clearRemembered','auth:tryRememberedLogin',
    'auth:getAuthorizeUrl','auth:oAuthStart','auth:oAuthCallback',
    'auth:exchangeOAuthCode','auth:listLinkedAccounts','auth:unlinkAccount','auth:isLinked',
    'posts:create','posts:update','posts:delete','posts:get','posts:list','posts:search','posts:filterByStatus',
    'posts:listTags','posts:listCategories',
    'dashboard:stats','dashboard:activity','dashboard:siteStatus',
    'settings:get','settings:set','settings:getTheme','settings:setTheme','settings:blogConfig',
    'settings:getCustomCss','settings:setCustomCss',
    'settings:getBackground','settings:setBackground','settings:clearBackground',
    'deploy:getConfig','deploy:setConfig','deploy:deploy','deploy:history','deploy:latest',
    'scanner:scan',
    'themes:list','themes:activate','themes:uninstall','themes:install','themes:listArchivedConfigs','themes:archiveConfig','themes:restoreArchivedConfig',
'plugins:list','plugins:install','plugins:uninstall','plugins:previewRecipe','plugins:applyRecipe','plugins:listRecipePackages','config:list','config:read','config:write','config:readTheme','config:writeTheme','config:readThemeByName','config:readBackup','config:readArchived','config:highlight','config:initThemeFile',
    'env:guide','env:detect','env:installHexo',
    'preview:start','preview:stop','preview:status','preview:openBrowser','preview:openWindow','preview:setF11Hook',
    'backup:exportJson','backup:exportBak','backup:restore',
    'markdown:render',
    'notice:manual',
    'files:openText','files:openImage',
    'pages:list','pages:create','pages:delete',
    'media:list','media:get','media:add','media:delete',
    'notices:list','notices:get','notices:add','notices:update','notices:delete',
    'market:searchThemes','market:searchPlugins','market:getPackage','market:downloadPackage',
    'market:installTheme','market:installPlugin','market:fetchStars','market:getCachedStars',
    'market:getRegistry','market:setRegistry',

  ],
  on: [
    'preview:f11',
    'preview:log',
    'oauth:callback',
    'oauth:error'
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
