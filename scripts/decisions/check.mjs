import { collect } from './lib.mjs';

const { records, errors } = await collect();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Decision checks passed: ${records.length} records. Work-item approval evidence and factual accuracy require review.`);
