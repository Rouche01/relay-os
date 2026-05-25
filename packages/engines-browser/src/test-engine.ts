import { PlaywrightEngine } from "./playwright-engine";
import { BrowserEngineAction } from "./types";

async function runTest() {
  const engine = new PlaywrightEngine();

  console.log("1. Starting Browser Engine...");
  await engine.healthCheck();

  try {
    console.log("\n2. Navigating to example.com...");
    const navResult = await engine.execute({
      type: "navigate",
      params: { url: "https://example.com" }
    } as BrowserEngineAction);
    
    console.log("Navigation Result:", navResult);

    console.log("\n3. Extracting main heading using Semantic Locator (role: 'heading')...");
    const extractResult = await engine.execute({
      type: "extract",
      params: {
        target: { role: "heading" }
      }
    } as BrowserEngineAction);
    
    console.log("Extract Result:", extractResult);

    console.log("\n4. Extracting paragraph using Semantic Locator (text match)...");
    const pResult = await engine.execute({
      type: "extract",
      params: {
        target: { text: "illustrative examples" }
      }
    } as BrowserEngineAction);

    console.log("Extract Paragraph Result:", pResult);

  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    console.log("\n5. Tearing down engine...");
    await engine.teardown();
    console.log("Teardown complete.");
  }
}

runTest();
