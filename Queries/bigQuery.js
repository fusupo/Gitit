/*jshint multistr: true */
//var api = require('../api.js');
var bigquery = require('bigquery-model');
var QueryData = require('../Schemas/queryData.js').QueryData;
var Results = require('../Schemas/result.js').Results;
var pubnubPublishKey = process.env.PUBNUB_PUBLISH_KEY || api.PUBNUB_PUBLISH_KEY;
var pubnubSubscribeKey = process.env.PUBNUB_SUBSCRIBE_KEY || api.PUBNUB_SUBSCRIBE_KEY;
var pubnub = require("pubnub")({
  ssl: true, // <- enable TLS Tunneling over TCP
  publish_key: pubnubPublishKey,
  subscribe_key: pubnubSubscribeKey
});
var db;
var unparsed_records; // VARIABLE TO STORE RAW INCOMING RECORDS
var parsed_records = []; // ARRAY TO STORE PARSED RECORD INFORMATION
var results_records; // STRING TO CHECK FOR DUPES
var bqemail = process.env.BIGDATA_EMAIL || api.EMAIL;
var bqpem = process.env.BIGDATA_PEM || api.PEM;
bigquery.auth({ // AUTHORIZATION INFO FOR GOOGLE BIG QUERY
  email: bqemail,
  key: bqpem
});

var table = new bigquery.Table({ // TABLE THAT HANDLES GET REQUESTS
  projectId: 'test1000-1055',
  datasetId: 'oldstuff',
  table: 'yes',
});

var saveUrlsToDB = function() { // FUNCTION THAT INSERTS ARRAY OF OBJECTS INTO DB
  var numSavedRecords = parsed_records.length;
  parsed_records.forEach(function(val) {
    var info = new QueryData({
      repo_name: val.repo_name,
      repo_url: val.repo_url
    });
    info.save(function(err, data) {
      if (err) {
        throw err;
      }
      numSavedRecords --;
      if(numSavedRecords === 0){
        console.log('BIGQUERY COMPLETE');
        db.close();
        emitPubNubEvent();
      }
    });
  });
};

var runQuery = function() {
  db = require('../Schemas/config.js');
  // QUERY TO GET NEW RECORDS FROM YESTERDAY
  table.query('SELECT repo.name, repo.url \
  FROM [githubarchive:day.yesterday] \
  WHERE payload CONTAINS \'"language":"JavaScript"\' \
  GROUP EACH BY repo.name, repo.url \
  ORDER BY repo.name')
    .then(function(records) { // STORES RECORDS
      unparsed_records = records;
    })
    .then(function() { // PARSES RECORDS
        Results.find(function(err, data){
          data = JSON.stringify(data);
          unparsed_records[0].rows.forEach(function(row, ind, arr) {
            var current = {};
            current.repo_name = row.f[0].v;
            current.repo_url = row.f[1].v;
            
            var repo = new RegExp(current.repo_name);
            if(data.match(repo) === null){
              parsed_records.push(current);
            } else {
              console.log('OMITTING DUPLICATE');
            }
            if(ind === arr.length-1){ 
              saveUrlsToDB();
            }
          });
        });
    });
};

// LISTEN ON PUBNUB MESSAGES !
pubnub.subscribe({
  channel: "gitit_messages",
  callback: function(message) {
    console.log("bigQueryWorker > ", message);
    if (message.type === 'heroku_scheduler_event') {
      runQuery();
    }
  }
});

var emitPubNubEvent = function() {
  var message = {
    "type": "bigQueryWorker_job_complete"
  };

  pubnub.publish({
    channel: 'gitit_messages',
    message: message,
    callback: function(e) {
      console.log("SUCCESS!", e);
    },
    error: function(e) {
      console.log("FAILED! RETRY PUBLISH!", e);
    }
  });
};
