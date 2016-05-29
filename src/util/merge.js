import fs from 'fs';
import readline from 'readline';

// const spawn = require('child_process').spawn;
const buffers = new Map();
const rootPath = '/Users/allanlukwago/apps/budget-data/samples';

// returns a file stream, which the csv stream pipes into
const writableStream = () => {
  const stream = fs.createWriteStream((`${rootPath}/mergedNew.csv`));
  return stream;
};

const readStream = (fileName) => (
  readline.createInterface({
    input: fs.createReadStream(`${rootPath}/${fileName}`)
  }));

const findTableHeading = (line) =>
  (/(^\bVote Name\b)(.*\bTable Name\b)/.test(line));


const createsReadStreams = (files) =>
  (files.map((fileName) => readStream(fileName)));

function fillDataBuffers(readerStreams) {
  let isATableHeadingLine = false;
  readerStreams.forEach((stream, index) => {
    const streamData = [];
    stream.on('line', (line) => {
      // we want to record the first table heading column
      if (index > 0) isATableHeadingLine = findTableHeading(line);
      if (!isATableHeadingLine) {
        streamData.push(`${line}\n`);
        buffers.set(index, streamData);
      }
    });
  });
}

function writeBuffersToFile(readerStreams) {
  const writer = writableStream();
  readerStreams.forEach((stream, index) => {
    stream.on('close', () => {
      const buffer = buffers.get(index);
      // cleanup buffers
      buffers.delete(index);
      // write to file
      buffer.forEach(line => writer.write(line));
    });
  });
}

function main() {
  const streams = createsReadStreams(['test1.csv', 'test2.csv']);
  fillDataBuffers(streams);
  writeBuffersToFile(streams);
}

main();
