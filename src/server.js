import { app, initializeApp } from "./app.js";
import { config } from "./config.js";

await initializeApp();

app.listen(config.port, () => {
  console.log(`The Passion Podcast live app is running at http://localhost:${config.port}`);
});
