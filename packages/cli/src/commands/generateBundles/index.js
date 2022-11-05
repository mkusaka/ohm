import fastGlob from 'fast-glob';
import fs from 'fs';
import ohm from 'ohm-js';
import path from 'path';

import {generateTypes} from '../../helpers/generateTypes.js';

const OHM_FILE_EXT = '.ohm';

function assertFileExtensionEquals(filename, ext) {
  const actual = path.extname(filename);
  if (actual !== ext) {
    throw new Error(`Wrong file extension: expected '${ext}', got '${actual}'`);
  }
}

class Plan {
  constructor() {
    this.plan = {filesToWrite: Object.create(null)};
  }

  write(filename, contents) {
    this.plan.filesToWrite[filename] = contents;
  }
}

class Writer {
  constructor(basePath) {
    this.basePath = basePath || '';
  }

  write(filename, contents) {
    const outputPath = path.join(this.basePath, filename);
    console.log(outputPath); // eslint-disable-line no-console
    fs.writeFileSync(outputPath, contents);
  }
}

const createBanner = (filename = undefined) =>
  `// AUTOGENERATED FILE
// This file was generated${filename ? ` from ${filename}` : ''} by \`ohm generateBundles\`.`;

function generateBundles(patterns, opts) {
  const {dryRun, cwd, withTypes, esm: isEsm} = opts;
  const plan = new Plan();
  const writer = dryRun ? plan : new Writer(cwd);

  for (const sourceFilename of fastGlob.sync(patterns, {cwd})) {
    const sourcePath = cwd ? path.join(cwd, sourceFilename) : sourceFilename;

    // Don't process any files that don't have the right file extension.
    if (path.extname(sourcePath) !== OHM_FILE_EXT) continue;

    const grammarSource = fs.readFileSync(sourcePath, 'utf-8');
    const grammars = ohm.grammars(grammarSource);
    generateRecipe(sourceFilename, grammars, writer, isEsm);
    if (withTypes) {
      generateTypesWithWriter(sourceFilename, grammars, writer);
    }
  }

  return plan.plan;
}

function generateRecipe(grammarPath, grammars, writer, isEsm) {
  assertFileExtensionEquals(grammarPath, OHM_FILE_EXT);

  const outputFilename = `${grammarPath}-bundle.js`;
  const isSingleGrammar = Object.keys(grammars).length === 1;

  let output = isEsm ?
    "import ohm from 'ohm-js';" :
    "'use strict';const ohm=require('ohm-js');";

  // If it's a single-grammar source file, the default export is the grammar.
  // Otherwise, the export is a (possibly empty) object containing the grammars.
  if (!isSingleGrammar) {
    output += 'const result={};';
  }
  for (const [name, grammar] of Object.entries(grammars)) {
    const {superGrammar} = grammar;
    const superGrammarExpr = superGrammar.isBuiltIn() ?
      undefined :
      `result.${superGrammar.name}`;
    output += isSingleGrammar ? 'const result=' : `result.${name}=`;
    output += `ohm.makeRecipe(${grammar.toRecipe(superGrammarExpr)});`;
  }
  output += isEsm ? 'export default result;' : 'module.exports=result;';
  writer.write(outputFilename, output);
}

function generateTypesWithWriter(grammarPath, grammars, writer) {
  assertFileExtensionEquals(grammarPath, OHM_FILE_EXT);

  const filename = path.basename(grammarPath);
  const contents = [createBanner(filename), '', generateTypes(grammars), ''].join('\n');
  writer.write(`${grammarPath}-bundle.d.ts`, contents);
}

export default {
  command: 'generateBundles <patterns...>',
  description: 'generate standalone modules (aka "bundles") from .ohm files',
  options: [
    ['-t, --withTypes', 'generate a corresponding .d.ts file for TypeScript'],
    ['-e, --esm', 'generate bundle in ES module format [default is CommonJS]'],
  ],
  action: generateBundles,
};
