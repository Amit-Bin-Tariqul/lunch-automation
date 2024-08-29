const { parentPort } = require('worker_threads');

const checkInterval = 60000; // 60 seconds
let votingEnabled = true;

const startTime = "09:00:00";
const endTime = "15:07:00";

function getCurrentTime() {
  const now = new Date();
  return now.toTimeString().split(' ')[0];
}

function checkVotingStatus() {
  const currentTime = getCurrentTime();
  
  if (currentTime >= startTime && currentTime < endTime) {
    if (votingEnabled) {
      votingEnabled = false;
      parentPort.postMessage({ action: 'disableVoting' });
    }
  } else {
    if (!votingEnabled) {
      votingEnabled = true;
      parentPort.postMessage({ action: 'enableVoting' });
    }
  }

  setTimeout(checkVotingStatus, checkInterval);
}

checkVotingStatus();
