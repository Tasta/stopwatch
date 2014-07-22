var StopwatchManager = require('./lib/stopwatch'),
    //ZMQ       = require('zmq'),
    redis = require("redis"),
    client = redis.createClient(),
    Express = require('express'),
    WGET = require('wget'),
    App = Express(),
    Config = require('./config').config,
    _ = require('underscore'),
    timediff = undefined


    function time() {
        return parseInt(new Date().getTime() / 1000) + timediff;
    }

var loaded = false

    function load_fromdb() {
        if (loaded) return;
        loaded = true
        client.hgetall('timers', function (err, datas) {
            if (err || !datas) return;
            _.forEach(datas, function (row, key) {
                if (typeof row == "string") {
                    row = JSON.parse(row);
                }
                create(key, Math.max(row.ts - time(), 0), row.url);
            }); 
        });
    }


    function sync_time() {
        client.time(function (err, time) {
            if (err) return sync_time();
            timediff = parseInt(new Date().getTime() / 1000) - parseInt(time);
            load_fromdb()
        });
    }

sync_time();

function Log(text)
{
    console.log(new Date(), text);
}

function destroy(id) {   
    var timer = StopwatchManager.get(id, {seconds: 1});
    timer.stop();	
    timer.removeAllListeners('tick');
    timer.removeAllListeners('end');
    client.hdel('timers', id);
    Log("[D] [ " + id + " ]  - auction ended");
};

function create(id, ts, url, next) {
    var realTs = ts + time(),
        timer = StopwatchManager.get(id, {
            seconds: ts
        });
        
    next = next || function () {}
    timer.restart();
    timer.on('end', function () {
        // url= url + (url.indexOf("?") > 0 ? "&" : "?") + "time=" + time()
        url=url ; //+  "/" + time(); 
        WGET.download(url, "/dev/null").on('error', function (err) {
            console.error(err);
        });
        client.hdel('timers', id);
        Log("[E] [ " + id + " ] - " + url + " [" + ts + " sec] ");
    });
    Log("[C] [ " + id + " ] - " + url + " [" + ts + " sec] " );
    client.hset('timers', id, JSON.stringify({
        ts: realTs,
        url: url
    }), function (err, response) {
        if (err) return next(err);
        next(null, {
            ts: realTs
        });
    });
}; 

App.get('/destroy/:id', function (req, res) {
    var id = req.params.id
    if (!id) {
        return res.status(500).send({
            error: 'id must be defined'
        });
    }
    destroy(id);
    return res.send({
        status: 'deleted'
    });
});

App.get('/timer/:id/:timeout', function (req, res) {
    var ts = parseInt(req.params.timeout),
        id = req.params.id,
        callback = req.query.callback

    if (!id) {
        return res.status(500).send({
            error: 'id must be defined'
        });
    }
    if (isNaN(ts)) {
        return res.status(500).send({
            error: 'timeout must be an integer'
        });
    }

    if (!callback || !/(https?):\/\/([_a-z\d\-]+(\.[_a-z\d\-]+)+)(([_a-z\d\-\\\.\/]+[_a-z\d\-\\\/])+)*/.test(callback)) {
        return res.status(500).send({
            error: 'callback url is missing or invalid'
        });
    }

    create(id, ts, callback, function (err, response) {
        if (err) {
            Log(err);
            return res.status(500).send({
                error: err
            });
        }
        return res.send({
            error: null,
            expires: response.ts
        });
    });
});

try {
    Config = require('./config-local').config;
} catch (e) {
}

App.listen(Config.port, Config.ip, function () {
    Log("Express NOSSL Server listening on " + Config.ip + ":" + Config.port);
});
