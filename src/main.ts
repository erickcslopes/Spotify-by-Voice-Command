import readline from "node:readline";
import { buildApp } from "./app/bootstrap";
import { getConfig } from "./config/config";

async function main(): Promise<void> {
  const config = await getConfig();
  const app = await buildApp(config);

  app.feedback.on((message) => console.log(`\n[app] ${message}`));

  const args = process.argv.slice(2);

  if (args.includes("--login")) {
    await app.auth.login();
    app.state.spotifyConnected = true;
    console.log("\nAutenticado no Spotify!");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Spotify Voice Assistant — modo texto");
  console.log("Digite um comando, 'parse <texto>' para só analisar, ou 'sair'.");
  console.log("");

  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    if (/^(sair|exit|quit)$/i.test(text)) break;

    if (/^parse\s+/i.test(text)) {
      const target = text.replace(/^parse\s+/i, "").trim();
      const result = await app.router.route(target);
      console.log(`\n[parse] ${JSON.stringify(result.results, null, 2)}`);
      continue;
    }

    await app.processCommand(text);

    console.log(
      `\n[metrics] total=${app.metrics.total} local=${app.metrics.local} ai=${app.metrics.ai} fallback=${app.getAiFallbackRate()}%`,
    );
  }

  rl.close();
}

main().catch((error) => {
  console.error("[erro fatal]", error);
  process.exit(1);
});