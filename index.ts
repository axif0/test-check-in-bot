import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";

async function run() {
  try {
    // Get inputs
    const token = core.getInput("repo-token");
    const daysInactive = parseFloat(core.getInput("days-inactive"));
    const checkInMessage = core.getInput("check-in-message");
    const commentMessage = core.getInput("comment-message");
    const botUsername = core.getInput("bot-username");
    const ignoreLabel = core.getInput("ignore-label") || "ignore-checkin";
    const stopComment = core.getInput("stop-comment") || "checkin stop";
    const skipPRs = core.getInput("skip-pr").toLowerCase() !== "false";
    const autoAddLabel = core.getInput("auto-add-label").toLowerCase() !== "false";

    // Log configuration
    core.info(`🔧 CONFIGURATION:`);
    core.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    core.info(`📅 Days inactive threshold: ${daysInactive}`);
    core.info(`🤖 Bot username: ${botUsername}`);
    core.info(`🏷️  Ignore label: ${ignoreLabel}`);
    core.info(`🛑 Stop comment: "${stopComment}"`);
    core.info(`⏩ Skip PRs: ${skipPRs ? 'Yes' : 'No'}`);
    core.info(`🔄 Auto add label: ${autoAddLabel ? 'Yes' : 'No'}`);
    core.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Set up Octokit
    core.info(`\n🚀 INITIALIZING:`);
    core.info(`Setting up GitHub API client...`);
    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;
    core.info(`Repository: ${owner}/${repo}`);

    // Search for open issues and PRs without the ignore label
    let query = `repo:${owner}/${repo} is:open -label:${ignoreLabel}`;
    if (skipPRs) {
      query += " is:issue"; // Only match issues, not PRs
      core.info(`🔍 Only processing issues (skipping PRs)`);
    } else {
      core.info(`🔍 Processing both issues and PRs`);
    }
    
    core.info(`Search query: ${query}`);
    const searchResponse = await octokit.paginate(octokit.search.issuesAndPullRequests, {
      q: query,
      per_page: 100,
    });

    core.info(`\n📊 SUMMARY:`);
    core.info(`Found ${searchResponse.length} items to process.`);

    const now = new Date();
    core.info(`Current time: ${now.toISOString()}`);
    
    let processedCount = 0;
    let skippedCount = 0;
    let commentedCount = 0;
    let stopCommentCount = 0;

    core.info(`\n🔄 PROCESSING ITEMS:`);
    core.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    for (const item of searchResponse) {
      processedCount++;
      
      // Get the type (issue or PR)
      const itemType = item.pull_request ? "PR" : "Issue";
      
      core.info(`\n[${processedCount}/${searchResponse.length}] ${itemType} #${item.number}: "${item.title || 'No title'}"`);
      core.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      core.info(`URL: ${item.html_url}`);
      core.info(`Created: ${new Date(item.created_at).toISOString()}`);
      
      // Fetch all comments for the issue or PR
      const comments = await octokit.paginate(octokit.issues.listComments, {
        owner,
        repo,
        issue_number: item.number,
        per_page: 100,
      });

      core.info(`📝 Comments: ${comments.length} total`);

      // Check for a "stop-comment" (e.g., "checkin stop") from a non-bot user
      const stopCommentObj = comments.find(
        (c) => c.user?.login !== botUsername && c.body?.toLowerCase().includes(stopComment.toLowerCase())
      );
      
      const hasStopComment = stopCommentObj !== undefined;

      // If a stop comment exists, apply the ignore-label (if autoAddLabel is true) and skip this issue/PR
      if (hasStopComment) {
        stopCommentCount++;
        const stopCommentDate = new Date(stopCommentObj.created_at).toISOString();
        const stopCommentUser = stopCommentObj.user?.login || 'unknown user';
        
        if (autoAddLabel) {
          core.info(`📛 SKIPPING: Found stop-comment '${stopComment}' from ${stopCommentUser} on ${stopCommentDate}`);
          core.info(`Applying label '${ignoreLabel}' and skipping.`);
          await octokit.issues.addLabels({
            owner,
            repo,
            issue_number: item.number,
            labels: [ignoreLabel],
          });
          core.info(`✓ Label '${ignoreLabel}' applied to ${itemType} #${item.number}`);
        } else {
          core.info(`📛 SKIPPING: Found stop-comment '${stopComment}' from ${stopCommentUser} on ${stopCommentDate}`);
          core.info(`Not applying label due to auto-add-label=false.`);
        }
        skippedCount++;
        continue; // Skip to the next issue/PR
      }

      // Find last user activity (most recent non-bot comment or issue creation)
      const userComments = comments.filter((c) => c.user?.login !== botUsername);
      core.info(`👤 User comments: ${userComments.length}`);
      
      let lastUserActivity = userComments.length > 0
        ? new Date(Math.max(...userComments.map((c) => new Date(c.created_at).getTime())))
        : new Date(item.created_at);
      
      const lastUserName = userComments.length > 0 
        ? userComments.find(c => new Date(c.created_at).getTime() === lastUserActivity.getTime())?.user?.login || 'unknown'
        : item.user?.login || 'unknown';
        
      core.info(`📅 Last user activity: ${lastUserActivity.toISOString()} by ${lastUserName}`);

      // Find last bot activity (most recent bot comment, if any)
      const botComments = comments.filter((c) => c.user?.login === botUsername);
      core.info(`🤖 Bot comments: ${botComments.length}`);
      
      const lastBotActivity = botComments.length > 0
        ? new Date(Math.max(...botComments.map((c) => new Date(c.created_at).getTime())))
        : null;
      
      if (lastBotActivity) {
        core.info(`🤖 Last bot activity: ${lastBotActivity.toISOString()}`);
      } else {
        core.info(`🤖 No previous bot activity found`);
      }

      // Calculate days since last user activity
      const daysSinceLastUser = (now.getTime() - lastUserActivity.getTime()) / (1000 * 60 * 60 * 24);
      core.info(`⏱️  Days inactive: ${daysSinceLastUser.toFixed(2)}`);

      // Check if a comment should be posted:
      // 1. User activity is older than the inactive threshold
      // 2. Bot hasn't commented yet OR the last user activity is more recent than last bot activity
      const inactivityCondition = daysSinceLastUser >= daysInactive;
      const botActivityCondition = lastBotActivity === null || lastUserActivity > lastBotActivity;
      
      core.info(`\n🔍 Decision criteria:`);
      core.info(`${inactivityCondition ? '✓' : '✗'} Inactivity threshold met (${daysSinceLastUser.toFixed(2)} days >= ${daysInactive} days required)`);
      core.info(`${botActivityCondition ? '✓' : '✗'} Bot hasn't commented or user commented after bot`);
      
      const shouldComment = inactivityCondition && botActivityCondition;

      if (shouldComment) {
        core.info(`\n✅ ACTION: Posting comment to ${itemType} #${item.number}`);
        // Start with the comment message template
        let finalMessage = commentMessage;
        
        // Super-simple replacement: Try different formats of the template variables
        const checkInVars = ["{{ check-in-message }}", "{{check-in-message}}", "{{ check-in-message}}", "{{check-in-message }}"];
        const daysInactiveVars = ["{{ days-inactive }}", "{{days-inactive}}", "{{ days-inactive}}", "{{days-inactive }}"];
        const stopCommentVars = ["{{ stop-comment }}", "{{stop-comment}}", "{{ stop-comment}}", "{{stop-comment }}"];
        
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
        
        // Try all possible formats for stop-comment with global replacement
        for (const stopCommentVar of stopCommentVars) {
          if (finalMessage.includes(stopCommentVar)) {
            finalMessage = finalMessage.split(stopCommentVar).join(stopComment);
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
        
        // After posting comment
        core.info(`✓ Comment posted successfully`);
        commentedCount++;
      } else {
        core.info(`\n❌ ACTION: Skipping comment on ${itemType} #${item.number}`);
        if (!inactivityCondition) {
          core.info(`  ∟ Reason: Not inactive long enough (${daysSinceLastUser.toFixed(2)} days < ${daysInactive} days required)`);
        }
        if (!botActivityCondition) {
          core.info(`  ∟ Reason: Bot already commented after the last user activity`);
        }
        skippedCount++;
      }
    }
    
    // Final summary
    core.info(`\n📊 FINAL SUMMARY:`);
    core.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    core.info(`Total items processed: ${processedCount}`);
    core.info(`Items with stop comments: ${stopCommentCount}`);
    core.info(`Items commented on: ${commentedCount}`);
    core.info(`Items skipped: ${skippedCount}`);
    core.info(`Check-in bot completed successfully!`);
    
  } catch (error) {
    core.info(`\n❌ ERROR:`);
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unknown error occurred.");
    }
  }
}

run();