import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";

async function run() {
  try {
    // Add initial debug message to confirm code execution
    core.info("🔍 CHECK-IN BOT STARTING");
    core.info("====================");
    
    // Get inputs
    const token = core.getInput("repo-token");
    const daysInactive = parseFloat(core.getInput("days-inactive"));
    const checkInMessage = core.getInput("check-in-message");
    const commentMessage = core.getInput("comment-message");
    const botUsername = core.getInput("bot-username");
    const ignoreLabel = core.getInput("ignore-label") || "ignore-checkin";
    const stopComment = core.getInput("stop-comment") || "checkin stop";
    
    // Log all input values to help with debugging
    core.info(`Configuration:`);
    core.info(`- Days inactive: ${daysInactive}`);
    core.info(`- Bot username: ${botUsername}`);
    core.info(`- Ignore label: ${ignoreLabel}`);
    core.info(`- Stop comment: ${stopComment}`);
    core.info(`- Check-in message length: ${checkInMessage?.length || 0} chars`);
    core.info(`- Comment message length: ${commentMessage?.length || 0} chars`);
    
    // Set up Octokit
    core.info("Setting up GitHub API client...");
    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;
    core.info(`Repository: ${owner}/${repo}`);

    // Search for open issues and PRs without the ignore label
    core.info("Searching for open issues and PRs...");
    const query = `repo:${owner}/${repo} is:open -label:${ignoreLabel}`;
    core.info(`Query: ${query}`);
    
    try {
      const searchResponse = await octokit.paginate(octokit.search.issuesAndPullRequests, {
        q: query,
        per_page: 100,
      });

      core.info(`Found ${searchResponse.length} issues/PRs to process.`);
      
      if (searchResponse.length === 0) {
        core.info("No matching issues/PRs found. Exiting.");
        return;
      }

      const now = new Date();
      core.info(`Current time: ${now.toISOString()}`);
      
      let processedCount = 0;
      let skippedCount = 0;
      let commentedCount = 0;

      core.info(`=== Starting processing of ${searchResponse.length} issues/PRs ===`);

      for (const item of searchResponse) {
        processedCount++;
        core.info(`\n[${processedCount}/${searchResponse.length}] Processing issue/PR #${item.number}: "${item.title || 'No title'}"`);

        // Fetch all comments for the issue or PR
        const comments = await octokit.paginate(octokit.issues.listComments, {
          owner,
          repo,
          issue_number: item.number,
          per_page: 100,
        });
        
        core.info(`  Found ${comments.length} comments for issue/PR #${item.number}`);

        // Check for a "stop-comment" (e.g., "checkin stop") from a non-bot user
        const hasStopComment = comments.some(
          (c) => c.user?.login !== botUsername && c.body?.toLowerCase().includes(stopComment.toLowerCase())
        );

        // If a stop comment exists, apply the ignore-label and skip this issue/PR
        if (hasStopComment) {
          skippedCount++;
          core.info(`  SKIPPING: Found stop-comment '${stopComment}' in issue/PR #${item.number}, applying label '${ignoreLabel}' and skipping.`);
          await octokit.issues.addLabels({
            owner,
            repo,
            issue_number: item.number,
            labels: [ignoreLabel],
          });
          continue; // Skip to the next issue/PR
        }

        // Find last user activity (most recent non-bot comment or issue creation)
        const userComments = comments.filter((c) => c.user?.login !== botUsername);
        let lastUserActivity = userComments.length > 0
          ? new Date(Math.max(...userComments.map((c) => new Date(c.created_at).getTime())))
          : new Date(item.created_at);

        // Find last bot activity (most recent bot comment, if any)
        const botComments = comments.filter((c) => c.user?.login === botUsername);
        const lastBotActivity = botComments.length > 0
          ? new Date(Math.max(...botComments.map((c) => new Date(c.created_at).getTime())))
          : null;

        // Calculate days since last user activity
        const daysSinceLastUser = (now.getTime() - lastUserActivity.getTime()) / (1000 * 60 * 60 * 24);

        core.info(`  Last user activity: ${lastUserActivity.toISOString()} (${daysSinceLastUser.toFixed(1)} days ago)`);
        core.info(`  Last bot activity: ${lastBotActivity ? lastBotActivity.toISOString() : 'none'}`);

        // Check if a comment should be posted:
        // 1. User activity is older than the inactive threshold
        // 2. Bot hasn't commented yet OR the last user activity is more recent than last bot activity
        const shouldComment = 
          daysSinceLastUser >= daysInactive &&
          (lastBotActivity === null || lastUserActivity > lastBotActivity);

        if (shouldComment) {
          commentedCount++;
          core.info(`  COMMENTING: Issue/PR #${item.number} is inactive for ${daysSinceLastUser.toFixed(1)} days (threshold: ${daysInactive} days).`);
          if (lastBotActivity === null) {
            core.info(`    Reason: No previous bot comment found.`);
          } else if (lastUserActivity > lastBotActivity) {
            core.info(`    Reason: Last user activity (${lastUserActivity.toISOString()}) is more recent than last bot comment (${lastBotActivity.toISOString()}).`);
          }
          
          // Start with the comment message template
          let finalMessage = commentMessage;
          
          // Super-simple replacement: Try different formats of the template variables
          const checkInVars = ["{{ check-in-message }}", "{{check-in-message}}", "{{ check-in-message}}", "{{check-in-message }}"];
          const daysInactiveVars = ["{{ days-inactive }}", "{{days-inactive}}", "{{ days-inactive}}", "{{days-inactive }}"];
          
          // Try all possible formats for check-in-message with global replacement
          for (const checkInVar of checkInVars) {
            if (finalMessage.includes(checkInVar)) {
              finalMessage = finalMessage.split(checkInVar).join(checkInMessage);
              break;
            }
          }
          
          // Try all possible formats for days-inactive with global replacement
          for (const daysInactiveVar of daysInactiveVars) {
            if (finalMessage.includes(daysInactiveVar)) {
              finalMessage = finalMessage.split(daysInactiveVar).join(daysInactive.toString());
              break;
            }
          }
          
          // Post the comment
          await octokit.issues.createComment({
            owner,
            repo,
            issue_number: item.number,
            body: finalMessage,
          });
          core.info(`    Comment posted successfully.`);
        } else {
          core.info(`  SKIPPING: Issue/PR #${item.number} does not meet criteria for commenting.`);
          if (daysSinceLastUser < daysInactive) {
            core.info(`    Reason: Not inactive long enough. Last activity was ${daysSinceLastUser.toFixed(1)} days ago (threshold: ${daysInactive} days).`);
          } else if (lastBotActivity !== null && lastUserActivity <= lastBotActivity) {
            core.info(`    Reason: Latest bot comment (${lastBotActivity.toISOString()}) is more recent than latest user activity (${lastUserActivity.toISOString()}).`);
          }
          skippedCount++;
        }
      }

      core.info(`\n=== Summary ===`);
      core.info(`Total issues/PRs processed: ${processedCount}`);
      core.info(`Issues/PRs commented on: ${commentedCount}`);
      core.info(`Issues/PRs skipped: ${skippedCount}`);
      
      core.info("🏁 CHECK-IN BOT COMPLETED SUCCESSFULLY");
    } catch (searchError) {
      core.error("Error while searching for issues:");
      core.error(searchError instanceof Error ? searchError.message : String(searchError));
      throw searchError;
    }
  } catch (error) {
    core.error("❌ CHECK-IN BOT FAILED");
    if (error instanceof Error) {
      core.error(error.message);
      core.setFailed(error.message);
    } else {
      core.error("An unknown error occurred.");
      core.setFailed("An unknown error occurred.");
    }
  }
}

run();