// Env vars:
//  TIMESTAMP_NOW       (Optional) = Use timestamp as time to check.
//  ISO3339_DATE_NOW    (Optional) = Use an ISO3339 date as time to check.
//  TIMESTAMP_CHECK     (Optional) = Use this timestamp for calculating sun's position on given day.
//  ISO3339_DATE_CHECK  (Optional) = Use an ISO3339 date for calculating sun's position on given day.
//  TIMEOUT             (Optional) = How long should the process wait in ms before writing state to disk (default: 30000 = 30 seconds)
//  STATE               (Optional) = File to save current state to. Defaults to 'state.json'
//  COMMAND             (Optional) = Command to run when time range is triggered
//  HTTP                (Optional) = HTTP address to call when time range is triggered. Previous and current state will be attached in the body for all but GET requests
//  HTTP_METHOD         (Optional) = HTTP method, defaults to GET
//  LAT                 (Required) = Latitude to check
//  LNG                 (Required) = Longitude to check
// Note: You cannot use both TIMESTAMP_* and ISO3339_DATE_* together; TIMESTAMP_* takes precedence

const stateFilePath = process.env.STATE || './state.json';
const lat = process.env.LAT;
const lng = process.env.LNG;
const commandExec = process.env.COMMAND;
const httpMethod = process.env.HTTP_METHOD || 'GET';
const httpUrl = process.env.HTTP;
const writeTimeout = parseInt(process.env.TIMEOUT || 30000);

const sunCalc = require('./suncalc');
const { exec } = require("child_process");
const http = require('http');
const fs = require('fs');

let commandDone = !commandExec;
let httpDone = !httpUrl;

const sendHttp = (url, method, state = {}, cb = () => {}) => {
  const headers = {
    'Content-Type': 'application/json'
  };

  let body;

  if (typeof(method) === 'string' && method.toLowerCase() !== 'get') {
    body = JSON.stringify(state);
  }

  http.request(url, {
    method,
    headers,
    body
  }, (resp) => {
    let data = '';
    resp.on('data', (chunk) => {
      data += chunk;
    });
    resp.on('end', () => {
      console.log(JSON.parse(data).explanation);
      cb(0, JSON.parse(data).explanation);
    });
  }).on("error", (err) => {
    console.log("Error: " + err.message);
    cb(1, {});
  });
};

if (!lat || !lng) {
  console.log("Set LAT and LNG environment variables");
  process.exit(1);
}

let currentState = {
  photoStates: {},
  outputs: {}
};

try {
  currentState = require(stateFilePath);
} catch (err) {
  console.log(`State file doesn't exist. Will create on save: '${stateFilePath}'`);
}

const writeToDisk = () => {
  fs.writeFile(stateFilePath, currentStateData, (err) => {
    if (err) {
      console.log(`Error: couldn't write state to disk ('${stateFilePath}'): ${err}`);
    }
    console.log(`currentState saved to disk: '${stateFilePath}'`);
    console.log("");
    console.log("");
    console.log("");
    process.exit(0);
  });
};

let checkTimeNow = process.env.ISO3339_DATE_NOW || new Date();
if (process.env.TIMESTAMP_NOW) {
  checkTimeNow = new Date(process.env.TIMESTAMP_NOW);
}

let checkDate = process.env.ISO3339_DATE_CHECK || new Date();
if (process.env.TIMESTAMP_CHECK) {
  checkDate = new Date(process.env.TIMESTAMP_CHECK);
}

const tomorrowDate = new Date(checkDate);
tomorrowDate.setDate(tomorrowDate.getDate() + 1);

const results = sunCalc.getTimes(checkDate, lat, lng);
const tomorrowResults = sunCalc.getTimes(tomorrowDate, lat, lng);

const previousState = JSON.parse(JSON.stringify(currentState));
currentState.dateCalculations = results;
currentState.lat = lat;
currentState.lng = lng;
currentState.timeRan = new Date();
currentState.inputNowTime = checkTimeNow;
currentState.inputCheckTime = checkDate;
currentState.inputTomorrowDate = tomorrowDate;
currentState.goldenHourAfternoon = false;
currentState.goldenHourMorning = false;
currentState.isGoldenHour = false;
currentState.isNighttime = false;
currentState.afterSolarNoon = false;

if (results.sunrise > checkTimeNow || results.sunset < checkTimeNow) {
  currentState.isNighttime = true;
}

if (results.solarNoon < checkTimeNow && !currentState.isNighttime) {
  currentState.afterSolarNoon = true;
  if (!currentState.photoStates.afterSolarNoonPhotoTaken) {
    currentState.lastEvent = "afterSolarNoon";
    currentState.photoStates.afterSolarNoonPhotoTaken = true;
    console.log('Event Triggered: afterSolarNoonPhotoTaken', currentState.photoStates.afterSolarNoonPhotoTaken);
    if (commandExec) {
      exec(commandExec, (error, stdout, stderr) => {
        currentState.outputs.commandExec = { command: commandExec, error, stdout, stderr };
        commandDone = true;
        if (httpDone && commandDone) { writeToDisk(); }
      });
    }
    if (httpUrl) {
      sendHttp(httpUrl, httpMethod, { currentState, previousState }, (resultCode, result) => {
        currentState.outputs.httpResult = { httpUrl, httpMethod, resultCode, result };
        httpDone = true;
        if (httpDone && commandDone) { writeToDisk(); }
      });
    }
  }
}

if (results.goldenHour < checkTimeNow && currentState.afterSolarNoon && !currentState.isNighttime) { // Between golden hour start and timetime start.
  currentState.goldenHourAfternoon = true;
  if (!currentState.photoStates.goldenHourAfternoonPhotoTaken) {
    currentState.lastEvent = "goldenHourAfternoonPhotoTaken";
    currentState.photoStates.goldenHourAfternoonPhotoTaken = true;
    console.log('Event Triggered: goldenHourAfternoonPhotoTaken', currentState.photoStates.goldenHourAfternoonPhotoTaken);
    if (commandExec) {
      exec(commandExec, (error, stdout, stderr) => {
        currentState.outputs.commandExec = { command: commandExec, error, stdout, stderr };
        commandDone = true;
        if (httpDone && commandDone) { writeToDisk(); }
      });
    }
    if (httpUrl) {
      sendHttp(httpUrl, httpMethod, { currentState, previousState }, (resultCode, result) => {
        currentState.outputs.httpResult = { httpUrl, httpMethod, resultCode, result };
        httpDone = true;
        if (httpDone && commandDone) { writeToDisk(); }
      });
    }
  }
}

if (results.goldenHourEnd > checkTimeNow && !currentState.isNighttime) { // Between golden hour end and nighttime end
  currentState.goldenHourMorning = true;
  if (!currentState.photoStates.goldenHourMorningPhotoTaken) {
    currentState.lastEvent = "goldenHourMorningPhotoTaken";
    currentState.photoStates.goldenHourMorningPhotoTaken = true;
    console.log('Event Triggered: goldenHourMorningPhotoTaken', currentState.photoStates.goldenHourMorningPhotoTaken);
    if (commandExec) {
      exec(commandExec, (error, stdout, stderr) => {
        currentState.outputs.commandExec = { command: commandExec, error, stdout, stderr };
        commandDone = true;
        if (httpDone && commandDone) { writeToDisk(); }
      });
    }
    if (httpUrl) {
      sendHttp(httpUrl, httpMethod, { currentState, previousState }, (resultCode, result) => {
        currentState.outputs.httpResult = { httpUrl, httpMethod, resultCode, result };
        httpDone = true;
        if (httpDone && commandDone) { writeToDisk(); }
      });
    }
  }
}

if (currentState.goldenHourMorning || currentState.goldenHourAfternoon) {
  currentState.isGoldenHour = true;
}

if (currentState.isNighttime) {
  currentState.photoStates.afterSolarNoonPhotoTaken = false;
  currentState.photoStates.goldenHourMorningPhotoTaken = false;
  currentState.photoStates.goldenHourAfternoonPhotoTaken = false;
}

let currentStateData = JSON.stringify(currentState, null, 2);
if (httpDone && commandDone) { writeToDisk(); }

setTimeout(() => {
  writeToDisk();
}, writeTimeout);

console.log(currentState);
