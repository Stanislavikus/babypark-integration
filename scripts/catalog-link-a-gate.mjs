#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const [gate,node,cli,...args]=process.argv.slice(2);if(!gate||!node||!cli)process.exit(2);while(!fs.existsSync(gate))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);const child=spawnSync(node,[cli,...args],{stdio:'inherit'});process.exit(child.status??2);
