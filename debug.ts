import * as core from "@actions/core";

// Basic test function
async function testDebug() {
  console.log("Console.log: Debug script started");
  core.info("Core.info: Debug script started");
  core.warning("This is a test warning");
  core.error("This is a test error (not failing the build)");
  
  // Test if async works
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  core.info("After 1 second delay");
  
  // Output 10 numbered messages to see what appears
  for (let i = 1; i <= 10; i++) {
    core.info(`Test message ${i}`);
  }
  
  core.info("Debug script complete");
}

// Run the test
testDebug().catch(error => {
  core.setFailed(`Debug script failed: ${error.message}`);
}); 