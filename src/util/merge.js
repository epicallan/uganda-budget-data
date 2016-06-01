import fs from 'fs';
import readline from 'readline';
import Rx from 'rxjs/Rx';
import path from 'path';

const buffers = new Map(); // for storing file data
const rootPath = '/Users/allanlukwago/apps/budget-data/samples';
// const rootPath = '/home/allan/budget-data-scraping/samples';


// returns a write stream for writing to the merge file
const writableStream = () => {
  const stream = fs.createWriteStream((`${rootPath}/merged.csv`));
  return stream;
};

const readStream = (filePath) => (
  readline.createInterface({
    input: fs.createReadStream(filePath)
  }));

// we dont want to have all the table headings from various
// tables in our final file, so when we find them
// we will skip them save for the first one
const findTableHeading = (line) =>
  (/(^\bVote Name\b)(.*\bTable Name\b)/.test(line));


const createsReadStreams = (files) =>
  (files.map((fileName) => readStream(fileName)));

export const hello = () => 'hello';

export const readDirFiles = (dir, annex, prefix) => {
  let re = new RegExp('.csv$');
  const directory = dir || __dirname;
  if (annex) re = new RegExp(`(${annex})(?=\.csv$)`);
  if (prefix) re = new RegExp(`(^${prefix})(?=.*\.csv$)`);
  const stream = Rx.Observable.bindNodeCallback(fs.readdir);
  return stream(directory)
    .flatMap(files => Rx.Observable.from(files))
    .filter(file => re.test(file))
    .map(file => path.resolve(directory, file));
};

function fillDataBuffers(readerStreams) {
  let isATableHeadingLine = false;
  readerStreams.forEach((stream, index) => {
    const streamData = [];
    stream.on('line', (line) => {
      // we want to record the first table heading row
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
      // write each line to file
      buffer.forEach(line => writer.write(line));
    });
  });
}

export default function main() {
  const streams = createsReadStreams(['test1.csv', 'test2.csv']);
  fillDataBuffers(streams);
  writeBuffersToFile(streams);
}

main();
