const {exec} = require('shelljs');
const minimist = require('minimist');

// Remove all command line flags from the arguments.
const argv = minimist(process.argv.slice(2));

// The command the user would like to run, either 'accept' or 'test'
const USER_COMMAND = argv._[0];

function runTSLint() {
  const result = exec(
      'yarn -s tslint-cmd -c tslint.json -t json "+(dev-infra|packages|modules|scripts|tools)/**/*.+(js|ts)"',
      {silent: true});
  const byFileName = {};
  const failures = JSON.parse(result.stdout);
  let total = 0;
  failures.filter(f => f.ruleName === 'no-any-extended').forEach(f => {
    total++;
    if (byFileName.hasOwnProperty(f.name)) {
      byFileName[f.name]++;
    } else {
      byFileName[f.name] = 1;
    }
  });
  const out = Object.keys(byFileName).sort().map(key => `${key}|${byFileName[key]}`);
  console.log(JSON.stringify(out, undefined, 2));
  console.log(total);
  return JSON.stringify(out);
}

switch (USER_COMMAND) {
  case 'accept':
    runTSLint('run');
    break;
  case 'test':
    runTSLint('test');
    break;
  default:
    console.warn('Invalid command provided.');
    console.warn();
    console.warn(`Run this script with either "accept" and "test"`);
    break;
}
