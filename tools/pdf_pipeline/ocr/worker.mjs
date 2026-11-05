// Local image-only OCR. Parent supplies bounded PNGs and verified local weights.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWorker } from 'tesseract.js';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let worker;
try {
  const job = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  if (!path.isAbsolute(job.image) || !path.isAbsolute(job.models) || ![3, 6, 7, 11].includes(job.psm) || !['eng', 'hin', 'eng+hin'].includes(job.languages)) throw Error('Invalid OCR job');
  const image = await fs.readFile(job.image);
  if (image.length > 40 * 1024 ** 2 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('PNG budget/signature');
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  if (!width || !height || width * height > 16_000_000) throw Error('Pixel budget');
  const manifest = JSON.parse(await fs.readFile(path.join(job.models, 'weights-manifest.json'), 'utf8'));
  for (const lang of ['eng', 'hin']) {
    const bytes = await fs.readFile(path.join(job.models, `${lang}.traineddata`));
    if (digest(bytes) !== manifest.files[`${lang}.traineddata`]?.sha256) throw Error('Weights mismatch');
  }
  worker = await createWorker(job.languages.split('+'), 1, {
    langPath: job.models, gzip: false, cacheMethod: 'none',
    errorHandler: () => {}, logger: () => {},
  });
  await worker.setParameters({ tessedit_pageseg_mode: String(job.psm), user_defined_dpi: '300' });
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true, tsv: true });
  const pkg = JSON.parse(await fs.readFile(new URL('node_modules/tesseract.js/package.json', import.meta.url)));
  const core = JSON.parse(await fs.readFile(new URL('node_modules/tesseract.js-core/package.json', import.meta.url)));
  process.stdout.write(JSON.stringify({ state: 'EXPERIMENTAL_NOT_ACCEPTED', publication_eligible: false,
    image_sha256: digest(image), width, height, languages: job.languages.split('+'), psm: job.psm,
    engine_versions: { 'tesseract.js': pkg.version, 'tesseract.js-core': core.version, node: process.version },
    text: data.text, confidence: data.confidence, blocks: data.blocks, tsv: data.tsv }));
} catch (error) {
  process.stderr.write(JSON.stringify({ error_type: error.name, state: 'EXPERIMENT_FAILED' }));
  process.exitCode = 1;
} finally {
  if (worker) await worker.terminate();
}
