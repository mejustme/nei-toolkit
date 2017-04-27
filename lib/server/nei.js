'use strict'
let _ = require('./util');
let QS = require("querystring");

// 路径配置
let ROOT = {
  PK: '',
  ONLINE: '',
  VIEW: '',
  MOCKTPL: '',
  MOCKAPI: '',
  FMPP: '',
  API_RES_HEADERS: ''
};

let VIEW_EXT = '';

function requestData(isNei, url, callback) {

  let isHttps = /^https:\/\//i.test(url);

  require(isHttps ? 'https' : 'http').get(url, function (res) {
    let ret = [];
    res.on('data', function (chunk) {
      ret.push(chunk.toString());
    });
    res.on('end', function () {
      let json = null;
      try {
        json = JSON.parse(ret.join(''));
      } catch (ex) {
        // ignore
      }
      if (isNei && json && json.code === 200) {
        // 成功
        if (json.result.error.length) {
          console.log(`错误: ${json.result.error.map(err => err.message).join(', ')}`);
        }
        // 真正的 mock 数据
        callback(json.result.json);

      } else if (!isNei && json){
        callback(json);

      }else {
        callback(ret.join(''))
      }
    });
  }).on('error', function (error) {
    callback(error.message);
  });

}

// 从nei站点获取数据
function get(type, id, callback, req) {

  if(ROOT.VIEW_DATA_BACKEND && type == 1){

    let suffix = ROOT.VIEW_DATA_BACKEND.params? '?' + QS.stringify(ROOT.VIEW_DATA_BACKEND.params) : '';
    let url = ROOT.VIEW_DATA_BACKEND.urlPrefix + req.url + suffix;

    console.log(`view数据来自: ${url}`);

    requestData(false, url, callback);

  }else{
    if (!ROOT.ONLINE) {
      // 不使用在线地址，则不获取数据
      return callback(null);
    }
    req = req || {};
    let params = {path: req.url, type: type, key: ROOT.PK, id: id, method: req.method};

    let url = `https://nei.netease.com/api/mockdata?` + QS.stringify(params);
    // let url = `http://localhost:8082/api/mockdata?` + QS.stringify(params);
    console.log(`Mock数据为NEI提供的在线接口: ${url}`);

    requestData(true, url, callback)
  }
}

// 加载数据
function load(type, id, path, callback, req) {
  let filter = null;
  try {
    let file = path + '.js';
    filter = require(file);
    delete require.cache[require.resolve(file)];
  } catch (ex) {
    // ignore
  }

  // 如果filter是个json对象
  if (filter && (typeof filter !== 'function')) {
    return callback(filter);
  }

  get(type, id, function (json) {
    if (json == null) {
      try {
        let file = path + '.json';
        console.log(`Mock数据为本地JSON文件: ${file}`);
        json = require(file);
        delete require.cache[require.resolve(file)];
      } catch (ex) {
        // ignore
      }
    }

    if (filter) {
      json = filter(json, req);
    }

    callback(json);
  }, req);
}

// api代理
function wrapApi(id, path) {
  return function (req, res, next) {
    load(3, id, ROOT.MOCKAPI + path, function (json) {
      // 不能直接发送数字, 数字会当作响应码
      if (typeof json == 'number') {
        json = json.toString();
      }
      // 设置api响应头
      Object.keys(ROOT.API_RES_HEADERS).forEach((key) => {
        res.set(key, ROOT.API_RES_HEADERS[key]);
      });
      res.send(json);
    }, req);
  };
}

// 页面代理
function wrapPage(index, list) {
  return function (req, res, next) {
    let conf = list[index];
    load(1, conf.i, ROOT.MOCKTPL + conf.p, function (json) {
      if (VIEW_EXT.toLowerCase() === '.ftl') {
        // ftl 模板, 需要 node fmpp 处理
        // 如果不包裹一层，传递的时候 data 上会多出 settings 等字段，见 /node-fmpp/index.js
        res.render(conf.p + VIEW_EXT, {
          json: json,
          fmppConfig: ROOT.FMPP
        });
      } else {
        res.render(conf.p + VIEW_EXT, json);
      }
    }, req);
  };
}

module.exports = {
  // 获取设置
  getting: function () {
    return ROOT;
  },
  // 设置接口
  setting: function (obj) {
    ROOT.PK = obj.projectKey;
    ROOT.ONLINE = obj.online;
    ROOT.VIEW = obj.view;
    ROOT.MOCKTPL = obj.mockTpl;
    ROOT.MOCKAPI = obj.mockApi;
    ROOT.FMPP = obj.fmpp;
    ROOT.API_RES_HEADERS = obj.apiResHeaders;
    ROOT.VIEW_DATA_BACKEND = obj.viewDataBackend;
    VIEW_EXT = obj.viewExt;
  },
  // 获取包装过的路由
  getRoutes: function (routes) {
    let retRoutes = {};
    Object.keys(routes || {}).forEach(function (i) {
      let item = routes[i];
      if (_.isObject(item)) {
        if (item.hasOwnProperty('list')) {
          // 页面
          let list = [];
          item.list.forEach(function (it) {
            list.push({i: it.id, p: it.path});
          });

          retRoutes[i] = {
            nei: true,
            data: item,
            handle: wrapPage(item.index, list)
          };
        } else {
          // api
          retRoutes[i] = {
            nei: true,
            data: item,
            handle: wrapApi(item.id, item.path)
          };
        }
      } else {
        retRoutes[i] = item;
      }
    });
    return retRoutes;
  }
};
