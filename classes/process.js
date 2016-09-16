"use strict";

var logger            = require("../libs/utils.js").logger;
var loadConfigSection = require("../libs/utils.js").loadConfigSection;
var replaceWith       = require("../libs/utils.js").replaceWith;
var spawn             = require("child_process").spawn;
var mysql             = require("mysql");
var pg                = require('pg'); //PostgreSQL
var bytes             = require("bytes");
var csv               = require("fast-csv");
var fs                = require('fs');

var Event = require("./event.js");

class Process {
  constructor(id, name, depends_process, depends_process_alt, exec, args, retries, retry_delay, limited_time_end, end_on_fail, end_chain_on_fail, events, status, execute_return, execute_err_return, started_at, ended_at, output, config, chain_values){
    this.id = id;
    this.name = name;
    this.depends_process = depends_process;
    this.depends_process_alt = depends_process_alt;
    this.exec = exec;
    this.args = args;
    this.retries = retries;
    this.retry_delay = retry_delay;
    this.limited_time_end = limited_time_end;
    this.end_on_fail = end_on_fail || false;
    this.end_chain_on_fail = end_chain_on_fail || false;
    this.output = output;

    //Runtime attributes:
    this.config = config;
    this.status = status || "stop";
    this.execute_return = execute_return;
    this.execute_err_return = execute_err_return;
    this.started_at = started_at;
    this.ended_at = ended_at;
    this.events;

    this.chain_values = chain_values;

    return new Promise((resolve) => {
      this.loadEvents(events)
      .then((events) => {
      this.events = events;
    resolve(this);
  })
  .catch(function(e){
      logger.log('error','Process constructor loadEvents:'+e);
      resolve(this);
    });
  });

  }

  values(){
    var _this = this;
    return {
      "CHAIN_ID":_this.chain_values.CHAIN_ID,
      "CHAIN_NAME":_this.chain_values.CHAIN_NAME,
      "CHAIN_STARTED_AT":_this.chain_values.CHAIN_STARTED_AT,
      "PROCESS_ID":_this.id,
      "PROCESS_NAME":_this.name,
      "PROCESS_EXEC":_this.exec,
      "PROCESS_ARGS":_this.args,
      "PROCESS_EXECURTE_ARGS":_this.execute_args,
      "PROCESS_EXECUTE_RETURN":_this.execute_return,
      "PROCESS_EXECUTE_ERR_RETURN":_this.execute_err_return,
      "PROCESS_STARTED_AT":_this.started_at,
      "PROCESS_ENDED_AT":_this.ended_at,
      "PROCESS_RETRIES_COUNT": _this.retries_count,
      "PROCESS_RETRIES": _this.retries,
      "PROCESS_DEPENDS_FILES_READY": _this.depends_files_ready,
      "PROCESS_FIRST_DEPEND_FILE_READY": (_this.depends_files_ready && _this.depends_files_ready.length > 0) ? _this.depends_files_ready[0] : [],
      "PROCESS_LAST_DEPEND_FILE_READY": (_this.depends_files_ready && _this.depends_files_ready.length > 0) ? _this.depends_files_ready[_this.depends_files_ready.length - 1] : [],
      "PROCESS_EXEC_DB_RESULTS":_this.execute_db_results,
      "PROCESS_EXEC_DB_RESULTS_CSV":_this.execute_db_results_csv,
      "PROCESS_EXEC_DB_FIELDCOUNT":_this.execute_db_fieldCount,
      "PROCESS_EXEC_DB_AFFECTEDROWS":_this.execute_db_affectedRows,
      "PROCESS_EXEC_DB_CHANGEDROWS":_this.execute_db_changedRows,
      "PROCESS_EXEC_DB_INSERTID":_this.execute_db_insertId,
      "PROCESS_EXEC_DB_WARNINGCOUNT":_this.execute_db_warningCount,
      "PROCESS_EXEC_DB_MESSAGE":_this.execute_db_message
    };
  }

  loadEvents(events){
    var _this = this;
    return new Promise((resolve) => {
        var processEventsPromises = [];

    if (events instanceof Object) {
      var keys = Object.keys(events);
      var keysLength = keys.length;
      if (keys  instanceof Array) {
        if (keysLength > 0) {
          while (keysLength--) {
            var event = events[keys[keysLength]];
            if(event.hasOwnProperty('notifications')){
              processEventsPromises.push(new Event(keys[keysLength],
                event.process,
                event.notifications,
                _this.config
              ));
            }else{
              logger.log('debug','Process Events without notifications');
            }
          }

          Promise.all(processEventsPromises)
            .then(function (eventsArr) {
              var events = {};
              var eventsArrLength = eventsArr.length;
              while (eventsArrLength--) {
                var e = eventsArr[eventsArrLength];
                var key = Object.keys(e);
                events[key[0]] = e[key[0]];
              }
              resolve(events);
            })
            .catch(function(e){
              logger.log('error','Process loadEvents: '+e);
              resolve();
            });
        }
      }
    }else{
      logger.log('error','Process, events is not object', err);
      resolve();
    }
  });
  }

  loadDbConfig(){
    var _this = this;

    return loadConfigSection(_this.config, 'db_connections', _this.exec.db_connection_id);
  }

  notificate(event){
    var _this = this;

    if(_this.hasOwnProperty('events') && _this.events !== undefined){
      if(_this.events.hasOwnProperty(event)){
        if(_this.events[event].hasOwnProperty('notifications')){
          if(_this.events[event].notifications instanceof Array){

            var notificationsLength = _this.events[event].notifications.length;
            while(notificationsLength--){
              _this.events[event].notifications[notificationsLength].notificate(_this.values())
                .then(function(res){
                  logger.log('debug','Notification process sended: '+res)
                })
                .catch(function(e){
                  logger.log('error',`Notificating ${event} process ${_this.id}:`+e)
                })
            }
          }
        }
      }
    }
  }

  isStoped(){
    return (this.status === 'stop');
  }

  isEnded(){
    return (this.status === 'end');
  }

  isRunning(){
    return (this.status === 'running');
  }

  isErrored(){
    return (this.status === 'error');
  }

  stop(){
    var _this = this;
    _this.status = 'stop';
    _this.ended_at = new Date();
  }

  end(noRunned){

    noRunned = noRunned || false; // If process has not been executed but we need set to end

    var _this = this;
    _this.status = 'end';
    _this.ended_at = new Date();

    //Clear depends_files_ready for re-check:
    _this.depends_files_ready = [];

    if(!noRunned){
      _this.notificate('on_end');
    }
  }

  error(){
    var _this = this;
    _this.status = 'error';
    _this.notificate('on_fail');
  }

  retry(){
    var _this = this;
    _this.notificate('on_retry');
  }

  waiting_dependencies(){
    var _this = this;
    _this.notificate('on_waiting_dependencies');
  }

  start(isRetry, forceOnceInRetry){
    var _this = this;
    _this.status = 'running';
    _this.started_at = new Date();

    if(!isRetry || isRetry === undefined){
      _this.notificate('on_start');
    }

    // forceOnceInRetry: this indicates that only try once in retry
    if(!forceOnceInRetry || forceOnceInRetry === undefined){
      forceOnceInRetry = false;
    }

    if(typeof _this.exec === 'string'){
      return _this.executeCommand(_this.exec);
    }else {
      switch (_this.exec.type) {
        case 'command':
          return _this.executeCommand(_this.exec.command);
          break;
        case 'mysql':
          return _this.executeMysql();
          break;
        case 'postgre':
          return _this.executePostgre();
          break;
        default:
          logger.log('error', `Exec type is not valid ${_this.exec.type} for ${_this.id}`);
          break;
      }
    }
  }

  executeCommand(cmd){
    var _this = this;
    return new Promise(function(resolve, reject) {
      var stdout = '';
      var stderr = '';

      function repArg(arg){
        return replaceWith(arg, _this.values());
      }
      _this.execute_args = _this.args.map(repArg);

      _this.proc = spawn(cmd, _this.execute_args);

      _this.proc.stdout.on('data', function(chunk) {
        stdout += chunk;
      });
      _this.proc.stderr.on('data', function(chunk) {
        stderr += chunk;
      });
      _this.proc
        .on('error', function(){
          //reject();
        })
        .on('close', function(code) {
          if (code === 0) {
            _this.execute_return = stdout;
            _this.execute_err_return = stderr;
            _this.end();
            _this.write_output();
            resolve(stdout);
          } else {
            logger.log('error',_this.id+' FIN: '+code+' - '+stdout+' - '+stderr);

            _this.execute_return = stdout;
            _this.execute_err_return = stderr;
            _this.retries_count = _this.retries_count +1 || 1;
            _this.error();
            _this.write_output();

            if(_this.retries >= _this.retries_count && !forceOnceInRetry){

              _this.retry();

              setTimeout(function(){
                _this.start(true)
                  .then(function(res) {
                    _this.retries_count = 0;
                    resolve(res);
                  })
                  .catch(function(e){
                    logger.log('error','Retrying process:'+e)
                    resolve(e);
                  });
              }, _this.retry_delay * 1000 || 0);

            }else{
              if (_this.end_on_fail){
                _this.end();
                _this.write_output();
              }
              reject(_this, stderr);
            }
          }
        });
    });
  }

  executeMysql(){
    var _this = this;

    return new Promise(function(resolve, reject) {

      if(_this.exec.db_connection_id){
        _this.loadDbConfig()
          .then((configValues) => {

          _this.execute_arg = _this.args

        var connection = mysql.createConnection({
          host       : configValues.host,
          user       : configValues.user,
          password   : configValues.password,
          database   : configValues.database,
          socketPath : configValues.socketPath,
          port       : configValues.port,
          ssl        : configValues.ssl,
          queryFormat:
            function (query, values) {
              if (!values) return query.replace(/(\:\/)/g,':');
              else {
                var _query = query.replace(/\:(\w+)/g, function (txt, key) {
                  return values && key && values.hasOwnProperty(key)
                    ? this.escape(replaceWith(values[key],_this.values()))
                    : null;
                }.bind(this)).replace(/(\:\/)/g,':');
              }
              return _query;
            }
        });

        connection.connect(function(err) {
          if (err) {
            logger.log('error','Error connecting Mysql: '+err)
            reject(err);
          }else{

            connection.query(_this.exec.command, _this.execute_arg, function(err, results) {
              if (err){
                logger.log('error',`executeMysql query ${_this.exec.command}: ${err}`);
                _this.execute_err_return = err;
                _this.execute_return = '';
                _this.error();
                _this.write_output();
                reject(err);
              }else{

                if(results instanceof Array){

                  _this.execute_db_results = JSON.stringify(results);
                  csv.writeToString(results, {headers: true}, function(err, data){
                    if(err){
                      logger.log('error',`Generating csv output for execute_db_results_csv. id: ${_this.id}: ${err}. Results: ${results}`);
                    }else{
                      _this.execute_db_results_csv = data;
                    }
                    _this.execute_return = '';
                    _this.execute_err_return = '';
                    _this.end();
                    _this.write_output();
                    resolve();
                  });

                }else{

                  if(results instanceof Object){
                    _this.execute_db_results      = '';
                    _this.execute_db_results_csv  = '';
                    _this.execute_db_fieldCount   = results.fieldCount;
                    _this.execute_db_affectedRows = results.affectedRows;
                    _this.execute_db_changedRows  = results.changedRows;
                    _this.execute_db_insertId     = results.insertId;
                    _this.execute_db_warningCount = results.warningCount;
                    _this.execute_db_message      = results.message;
                  }

                  _this.execute_return = '';
                  _this.execute_err_return = '';
                  _this.end();
                  _this.write_output();
                  resolve();

                }
              }
            });
            connection.end();
          }
        });
      })
      .catch(function(err){
          logger.log('error',`executeMysql loadDbConfig: ${err}`);
          _this.execute_err_return = `executeMysql loadDbConfig: ${err}`;
          _this.execute_return = '';
          _this.error();
          _this.write_output();
          reject(err);
        });

      }else{
        logger.log('error',`db_connection_id not set for ${_this.id}`);
        _this.execute_err_return = `db_connection_id not set for ${_this.id}`;
        _this.execute_return = '';
        _this.error();
        _this.write_output();
        reject();
      }
    });
  }

  executePostgre(){
    var _this = this;

    function queryFormat(query, values) {
      if (!values) return query.replace(/(\:\/)/g,':');
      else {
        var _query = query.replace(/\:(\w+)/g, function (txt, key) {
          return values && key && values.hasOwnProperty(key)
            ? escape(replaceWith(values[key],_this.values()))
            : null;
        }.bind(this)).replace(/(\:\/)/g,':');
      }
      return _query;
    }

    return new Promise(function(resolve, reject) {

      if(_this.exec.db_connection_id){
        _this.loadDbConfig()
          .then((configValues) => {

            _this.execute_arg = _this.args

            var client = new pg.Client({
              user     : configValues.user,
              password : configValues.password,
              database : configValues.database,
              host     : configValues.host || configValues.socketPath,
              port     : configValues.port
            });
            client.connect(function(err) {
              if(err) {
                logger.log('error',`Could not connect to Postgre: `+err);
                _this.execute_err_return = err;
                _this.execute_return = '';
                _this.error();
                _this.write_output();
                reject(err);
              }else{
                var finalQuery = queryFormat(_this.exec.command, _this.execute_arg);

                client.query(finalQuery, null, function(err, results){
                  if(err){
                    logger.log('error',`Error query Postgre (${finalQuery}): `+err);
                    _this.execute_err_return = err;
                    _this.execute_return = '';
                    _this.error();
                    _this.write_output();
                    reject(`Error query Postgre (${finalQuery}): `+err);
                  }else{
                    if(results.hasOwnProperty('rows') && results.rows.length > 0){

                      _this.execute_db_results = JSON.stringify(results.rows);
                      csv.writeToString(results.rows, {headers: true}, function(err, data){
                        if(err){
                          logger.log('error',`Generating csv output for execute_db_results_csv. id: ${_this.id}: ${err}. Results: ${results}`);
                        }else{
                          _this.execute_db_results_csv = data;
                        }
                        _this.execute_return = '';
                        _this.execute_err_return = '';
                        _this.end();
                        _this.write_output();
                        resolve();
                      });

                    }else{

                      if(results instanceof Object){
                        _this.execute_db_results      = '';
                        _this.execute_db_results_csv  = '';
                        _this.execute_db_fieldCount   = results.rowCount;
                        _this.execute_db_affectedRows = '';
                        _this.execute_db_changedRows  = '';
                        _this.execute_db_insertId     = results.oid;
                        _this.execute_db_warningCount = '';
                        _this.execute_db_message      = '';
                      }

                      _this.execute_return = '';
                      _this.execute_err_return = '';
                      _this.end();
                      _this.write_output();
                      resolve();
                    }

                  }
                  client.end();
                })
              }
            });
      })
      .catch(function(err){
          logger.log('error',`executePostgre loadDbConfig: ${err}`);
          _this.execute_err_return = `executePostgre loadDbConfig: ${err}`;
          _this.execute_return = '';
          _this.error();
          _this.write_output();
          reject(err);
        });

      }else{
        logger.log('error',`executePostgre: db_connection_id not set for ${_this.id}`);
        _this.execute_err_return = `executePostgre: db_connection_id not set for ${_this.id}`;
        _this.execute_return = '';
        _this.error();
        _this.write_output();
        reject();
      }
    });

  }

  write_output(){
    var _this = this;

    function repArg(arg){
      return replaceWith(arg, _this.values());
    }

    function writeFile(filePath, mode, os){
      fs.open(filePath, mode, (err, fd) => {
        fs.write(fd, os, null, 'utf8', function(){
        fs.close(fd, function(err){
          if(err){
            logger.log('error',`Closing file ${filePath} in writeFile in ${_this.id}: `,err);
          }
        });
      });
    });
    }

    function generateOutput(output){

      if(output && output.file_name && output.write.length > 0){

        var filePath = replaceWith(output.file_name, _this.values());
        var output_stream = output.write.map(repArg).filter(Boolean).join("\n");

        if(output.maxsize) {
          var maxSizeBytes = bytes(output.maxsize);
          var output_stream_length = output_stream.length;

          if(output_stream_length > maxSizeBytes){
            output_stream = output_stream.slice(output_stream_length - maxSizeBytes,output_stream_length);
            output_stream_length = maxSizeBytes;
            logger.log('debug',`output_stream truncated output_stream_length (${output_stream_length}) > maxSizeBytes (${maxSizeBytes})`);
          }
        }

        if(output.concat){
          if(output.maxsize){
            fs.stat(filePath, function(error, stats) {

              var fileSizeInBytes = 0;
              if(!error){
                fileSizeInBytes = stats.size;
              }
              //SI LA SUMA DEL TAMAÑO DEL FICHERO Y EL OUTPUT A ESCRIBIR DEL PROCESO SUPERAN EL MAXIMO PERMITIDO
              var totalSizeToWrite = fileSizeInBytes + output_stream_length;

              if(totalSizeToWrite > maxSizeBytes){
                //SE OBTIENE LA PARTE DEL FICHERO QUE JUNTO CON EL OUTPUT SUMAN EL TOTAL PERMITIDO PARA ESCRIBIRLO (SUSTIUYENDO EL FICHERO)
                var positionFileRead   =  (totalSizeToWrite) - maxSizeBytes;
                var lengthFileRead =  (fileSizeInBytes) - positionFileRead;

                fs.open(filePath, 'r', function(error, fd) {
                  if(lengthFileRead > 0){
                    var buffer = new Buffer(lengthFileRead);

                    fs.read(fd, buffer, 0, buffer.length, positionFileRead, function(error, bytesRead, buffer) {
                      var data = buffer.toString("utf8", 0, buffer.length);
                      data = data.concat("\n",output_stream);
                      fs.close(fd, function(err){
                        if(err){
                          logger.log('error',`Closing file ${filePath} in ${_this.id}: `,err);
                        }
                        writeFile(filePath, 'w', data);
                      });
                    });
                  }else{
                    //SI NO SE VA A ESCRIBIR NADA DEL FICHERO ACTUAL
                    writeFile(filePath, 'w', output_stream);
                  }
                });
              }else{
                writeFile(filePath, 'a+', output_stream);
              }
            });
          }else{
            writeFile(filePath, 'a+', output_stream);
          }

        }else{
          writeFile(filePath, 'w+', output_stream);
        }
      }
    }

    if(_this.output instanceof Array){
      var outputCountItems = _this.output.length;

      while(outputCountItems--){
        generateOutput(_this.output[outputCountItems]);
      }
    }else{
      generateOutput(_this.output);
    }

  }
}

module.exports = Process;