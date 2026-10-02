import { config } from '../config/index.js';
import { createApp } from './app.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`\n  Herramienta de Prospección lista en http://localhost:${config.port}\n`);
});
