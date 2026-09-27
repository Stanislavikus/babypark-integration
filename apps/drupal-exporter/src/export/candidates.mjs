import fs from 'node:fs';
import path from 'node:path';
import { streamNdjson } from '../source/stream-index.mjs';

export function candidatesPathFor(sourceDir) {
  return path.join(sourceDir, 'candidates.ndjson');
}

export function appendCandidateProduct(candidatesPath, product) {
  fs.appendFileSync(candidatesPath, `${JSON.stringify(product)}\n`);
}

export async function streamCandidateProducts(candidatesPath, onProduct) {
  await streamNdjson(candidatesPath, onProduct);
}

export async function loadAllCandidateProducts(candidatesPath) {
  const products = [];
  await streamCandidateProducts(candidatesPath, product => {
    products.push(product);
  });
  return products;
}

export async function countCandidateProducts(candidatesPath) {
  let count = 0;
  await streamCandidateProducts(candidatesPath, () => {
    count += 1;
  });
  return count;
}
