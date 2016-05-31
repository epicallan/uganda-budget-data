import fs from 'fs';
import readline from 'readline';
import csv from 'fast-csv';
import {
  budgetSegmentsToRead,
  transformRegular,
  transformOverview,
  transformForEstimates,
  transformForAnnexTables } from './config';
import program from './cli';

const spawn = require('child_process').spawn;

const pdftoTextProcess = () => (spawn('pdftotext',
['-layout', '-f', program.first, '-l', program.last, program.args[0]]));

// returns a file stream, which the csv stream pipes into
const writableStream = () => {
  const date = new Date();
  const time = date.getTime();
  const csvFileName = `${program.name}-${time}` || time;
  const stream = fs.createWriteStream(`${csvFileName}.csv`);
  return stream;
};

const getRowTransformFunc = () => {
  if (program.annex) return transformForAnnexTables;
  if (program.estimates) return transformForEstimates;
  const transform = program.overview ? transformOverview : transformRegular;
  return transform;
};

// configuring csv stream object which feeds into the file stream
const csvStream = () => {
  const writeStream = writableStream();
  const stream = csv.createWriteStream({ headers: true });
  // adding a transformation function that is responsible for the row titles
  const transform = getRowTransformFunc();
  stream.transform(transform)
  .pipe(writeStream);
  return stream;
};

// transform sentences to array and removes empty elements(space) in the array
const csvLineTowrite = (line) => line.split('  ').filter(word => word.length > 1);

// we are only interested in sentence lines that have numerical values
export const shouldHaveNumericalValues = (line) => {
  const chunkedLine = csvLineTowrite(line);
  if (chunkedLine.length < 7) return false;
  const lastValues = chunkedLine.slice(2, chunkedLine.length);
  const values = lastValues.map(val => {
    let value = val;
    if (val.includes('N/A')) value = 0;
    return parseInt(value, 10);
  });
  const isLineValid = values.every(val => Number.isInteger(val));
  return isLineValid;
};

// another quack, this is in the annex tables
// some numbers in two adjoining cells come out joined
export const splitJoinedNumbers = (joined) => {
  const splitted = joined.split('.');
  if (splitted.length !== 3) return joined;
  const subFirstNum = splitted[1].substring(0, 2);
  const firstNumber = `${splitted[0]}.${subFirstNum}`;
  const subSecondNumber = splitted[1].substring(2, -1);
  const SecondNumber = `${subSecondNumber}.${splitted[2]}`;
  return [firstNumber, SecondNumber];
};

export const annexCsvLine = line => {
 // get line name or title
  const csvLine = csvLineTowrite(line);
  const lineName = csvLine[0].replace(/^\s+/, '');
  // remove lineName from line
  const newLine = /[ab-z]/.test(lineName) ? line.replace(lineName, '') : line;
  // replace all double spaces with single spaces
  const chunkedLine = newLine.replace(/\s+/g, ' ').split(' ');
  // console.log(lineName, lineName);
  if (/^\d+/.test(lineName)) {
    const filtered = chunkedLine.filter(word => word.length > 1);
    // if the first item is made up of joined up numbers it will return a split array
    const splitNumbers = splitJoinedNumbers(filtered[0]);
    if (splitNumbers.length === 2) {
      filtered.shift();
      return [...splitNumbers, filtered];
    }
    return filtered;
  }
  // add lineName back to the newLine and remove any empty spaces
  return [lineName, ...chunkedLine].filter(word => word.length > 1);
};

const writeLineForEstimatesTables = (line, { title, stream }) => {
  if (!title.includes('FY 2015/16 PAF')) return false;
  const hasNumericalValues = shouldHaveNumericalValues(line);
  if (!hasNumericalValues) return false;
  const csvLine = csvLineTowrite(line);
  if (csvLine.length > 7) csvLine.shift();
  console.log([title, ...csvLine]);
  stream.write([title, ...csvLine]);
  return true;
};
// coz of line numbers at the bottom of the page
// the line is returned at the end of that number
// hence turning out shorter
// so we cache that line as prevShortLine and return false
// then we wait for the next line which is also short and we add them together
let prevShortLine = null;

const writeLineForAnnexTables = (line, { title, stream }) => {
  if (!title.includes('Annex')) return false;
  const hasNumericalValues = shouldHaveNumericalValues(line);
  if (!hasNumericalValues) return false;
  const csvLine = annexCsvLine(line);
  // console.log('line length:', csvLine.length);
  if (csvLine.length < 9) {
    prevShortLine = [title, ...csvLine];
    // console.log(prevShortLine.join(','));
    return false;
  }
  if (prevShortLine && csvLine.length < 19) {
    // prevShortLine.pop();
    stream.write([...prevShortLine, ...csvLine]);
    prevShortLine = null;
    return true;
  }
  stream.write([title, ...csvLine]);
  return true;
};
// function we use to writing out csv lines for regular tables
// to the csv file
const writeLineToFileRegular = (line, { title, voteTitle, stream }) => {
  if (title.includes('Overview of Vote Expenditures') || title.includes('Annex')) return false;
  const hasNumericalValues = shouldHaveNumericalValues(line);
  // check whether we have numbers after the first items in the array
  if (!hasNumericalValues) return false;
  const csvLine = csvLineTowrite(line);
  if (csvLine.length !== 7) csvLine.splice(0, 2, `${csvLine[0]} ${csvLine[1]}`);
  stream.write([...csvLine, title, voteTitle]);
  return true;
};

// tne line that has non wage seems to some time miss a value which with the previous line
// so we cache it till the line that needs it comes up and we use it
let missingValue = null;
// function we use to writing out csv lines for the overviewVoteExpenditure table
// which is abit different from the rest of the tables
const writeLineToOverView = (line, { title, voteTitle, stream }) => {
  if (!title.includes('Overview of Vote Expenditures')) return false;
  const csvLine = csvLineTowrite(line);
  if (line.includes('Recurrent')) missingValue = csvLine[1];
  // check whether we have numbers after the first items in the array
  const hasNumericalValues = shouldHaveNumericalValues(line);
  if (!hasNumericalValues) return false;
  // table structure quacks
  if (line.includes('Non Wage') && missingValue) csvLine.splice(2, 0, missingValue);
  if (line.includes('and Taxes')) csvLine.splice(0, 2, csvLine[1]);
  stream.write([...csvLine, title, voteTitle]);
  return true;
};

export const getVoteTitle = (line, currentVote) => {
  // remove extra white space at the beginning of the line if any
  const newLine = line.replace(/^\s+/, '');
  // the line should start with Vote:
  const hasVoteHasFirstLine = /^Vote:/.test(newLine);
  if (!hasVoteHasFirstLine) return currentVote;
  // should have the vote Number
  const chunkedLine = newLine.replace(/\s{2,}/, ' ').split(' ');
  // test whether 2nd element is a number and third a string
  const isNumber = Number.isInteger(parseInt(chunkedLine[1], 10));
  if (!isNumber) return currentVote;
  if (isNumber && typeof chunkedLine[2] === 'string') {
    const voteTitle = newLine.replace(/(Vote:)(.*[0-9])(.\s)/, '');
    return voteTitle.replace(/^\s+/, '');
  }
  return currentVote;
};

const isNewTableTitle =
  (segments, line) => segments.some(segment => line.includes(segment.tableTitle));

const getWriteCsvLineFunc = () => {
  if (program.annex) return writeLineForAnnexTables;
  if (program.estimates) return writeLineForEstimatesTables;
  const write = program.overview ? writeLineToOverView : writeLineToFileRegular;
  return write;
};

function writeCSVFile(segments, readFileByLine, stream) {
  let startMining = false;
  let isTableTitle = false;
  let title = null;
  let voteTitle = null;
  const writeCsvLine = getWriteCsvLineFunc();
  readFileByLine.on('line', (line) => {
    isTableTitle = isNewTableTitle(segments, line);
    voteTitle = getVoteTitle(line, voteTitle);
    if (isTableTitle) {
      title = segments.find(segment => line.includes(segment.tableTitle)).tableTitle;
      startMining = true;
      console.log(`voteTitle: ${voteTitle} Title : ${title}`);
    }
    if (startMining) writeCsvLine(line, { title, voteTitle, stream });
  });
}

const readByLine = () => {
  const minedTextFile = program.args[0].split('.');
  return readline.createInterface({
    input: fs.createReadStream(`${minedTextFile[0]}.txt`)
  });
};

const closeReadingTextFile = (readFileByLine, stream) => {
  readFileByLine.on('close', () => {
    stream.end();
    console.log('*finished reading files closing*');
    setTimeout(() => process.exit, 2000); // exit process
  });
};

function main() {
  const pdfMining = pdftoTextProcess();
  const csvWriteStream = csvStream();

  pdfMining.stderr.on('data', (data) => {
    console.log(`stderr : ${data}`);
    process.exit();
  });

  pdfMining.on('close', (code) => {
    console.log(`child process for PDFtoText exited with code  ${code}`);
    setTimeout(() => {
      const readFileByLine = readByLine();
      writeCSVFile(budgetSegmentsToRead, readFileByLine, csvWriteStream);
      closeReadingTextFile(readFileByLine, csvWriteStream);
    }, 2000);
  });
}

if (program.args.length && process.env.NODE_ENV !== 'test') main();
