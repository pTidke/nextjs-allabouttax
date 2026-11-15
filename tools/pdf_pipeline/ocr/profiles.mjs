// Fixed structural priors only. Never accept answer text or a sequence as a parameter.
export function parametersFor(job) {
  if (Object.keys(job).some(key => !['image','models','psm','languages','profile'].includes(key))) throw Error('Unexpected OCR job field');
  const profile = job.profile ?? 'text';
  if (!['text', 'numeric_label'].includes(profile)) throw Error('Unknown OCR profile');
  if (!['eng', 'hin', 'eng+hin'].includes(job.languages) || ![3, 6, 7, 10, 11].includes(job.psm)) throw Error('Invalid OCR settings');
  if (profile === 'numeric_label' && (job.languages !== 'eng' || ![7,10].includes(job.psm))) throw Error('Numeric label profile requires English line/glyph OCR');
  const parameters = { tessedit_pageseg_mode: String(job.psm), user_defined_dpi: '300' };
  if (profile === 'numeric_label') parameters.tessedit_char_whitelist = '0123456789.';
  return parameters;
}
