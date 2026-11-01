/* Kalidad · base de datos local (IndexedDB). Aquí viven las fotos pendientes y los PDF creados. */
(function (root) {
  'use strict';
  var NAME = 'kalidad', VER = 1, dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var rq = indexedDB.open(NAME, VER);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('fotos')) db.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'id', autoIncrement: true });
      };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
    return dbp;
  }

  function run(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode);
        var out = fn(tx.objectStore(store));
        tx.oncomplete = function () { resolve(out && 'result' in out ? out.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  var api = {
    all: function (store) { return run(store, 'readonly', function (s) { return s.getAll(); }); },
    add: function (store, rec) { return run(store, 'readwrite', function (s) { return s.add(rec); }); },
    put: function (store, rec) { return run(store, 'readwrite', function (s) { return s.put(rec); }); },
    remove: function (store, ids) {
      return run(store, 'readwrite', function (s) { (Array.isArray(ids) ? ids : [ids]).forEach(function (id) { s.delete(id); }); });
    }
  };
  root.DB = api;
})(self);
