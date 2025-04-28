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

    // Set up Octokit
    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;

    // Search for open issues and PRs without the ignore label
    const query = `repo:${owner}/${repo} is:open -label:${ignoreLabel}`;
    const searchResponse = await octokit.paginate(octokit.search.issuesAndPullRequests, {
      q: query,
      per_page: 100,
    });

    core.info(`Found ${searchResponse.length} issues/PRs to process.`);

    const now = new Date();

    for (const item of searchResponse) {
      core.info(`Processing issue/PR #${item.number}`);
      core.info(`-----------------------------------------`);

      // Fetch all comments for the issue or PR
      const comments = await octokit.paginate(octokit.issues.listComments, {
        owner,
        repo,
        issue_number: item.number,
        per_page: 100,
      });

      core.info(`Found ${comments.length} total comments on issue/PR #${item.number}`);

      // Check for a "stop-comment" (e.g., "checkin stop") from a non-bot user
      const hasStopComment = comments.some(
        (c) => c.user?.login !== botUsername && c.body?.toLowerCase().includes(stopComment.toLowerCase())
      );

      // If a stop comment exists, apply the ignore-label and skip this issue/PR
      if (hasStopComment) {
        core.info(`📛 SKIPPING: Found stop-comment '${stopComment}' in issue/PR #${item.number}, applying label '${ignoreLabel}' and skipping.`);
        await octokit.issues.addLabels({
          owner,
          repo,
          issue_number: item.number,
          labels: [ignoreLabel],
        });
        core.info(`Label '${ignoreLabel}' applied to issue/PR #${item.number}`);
        continue; // Skip to the next issue/PR
      }

      // Find last user activity (most recent non-bot comment or issue creation)
      const userComments = comments.filter((c) => c.user?.login !== botUsername);
      core.info(`Found ${userComments.length} user comments (non-bot) on issue/PR #${item.number}`);
      
      let lastUserActivity = userComments.length > 0
        ? new Date(Math.max(...userComments.map((c) => new Date(c.created_at).getTime())))
        : new Date(item.created_at);
      
      core.info(`Last user activity on issue/PR #${item.number}: ${lastUserActivity.toISOString()}`);

      // Find last bot activity (most recent bot comment, if any)
      const botComments = comments.filter((c) => c.user?.login === botUsername);
      core.info(`Found ${botComments.length} bot comments on issue/PR #${item.number}`);
      
      const lastBotActivity = botComments.length > 0
        ? new Date(Math.max(...botComments.map((c) => new Date(c.created_at).getTime())))
        : null;
      
      if (lastBotActivity) {
        core.info(`Last bot activity on issue/PR #${item.number}: ${lastBotActivity.toISOString()}`);
      } else {
        core.info(`No previous bot activity found on issue/PR #${item.number}`);
      }

      // Calculate days since last user activity
      const daysSinceLastUser = (now.getTime() - lastUserActivity.getTime()) / (1000 * 60 * 60 * 24);
      core.info(`Days since last user activity on issue/PR #${item.number}: ${daysSinceLastUser.toFixed(1)}`);

      // Check if a comment should be posted:
      // 1. User activity is older than the inactive threshold
      // 2. Bot hasn't commented yet OR the last user activity is more recent than last bot activity
      const inactivityCondition = daysSinceLastUser >= daysInactive;
      const botActivityCondition = lastBotActivity === null || lastUserActivity > lastBotActivity;
      
      core.info(`Conditions for issue/PR #${item.number}:`);
      core.info(`- Inactivity threshold met (${daysSinceLastUser.toFixed(1)} >= ${daysInactive})? ${inactivityCondition}`);
      core.info(`- Bot hasn't commented yet or user commented after bot? ${botActivityCondition}`);
      
      const shouldComment = inactivityCondition && botActivityCondition;

      if (shouldComment) {
        core.info(`✅ COMMENTING: Issue/PR #${item.number} is inactive for ${daysSinceLastUser.toFixed(1)} days, posting comment.`);
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
        
        // After posting comment
        core.info(`Comment posted successfully to issue/PR #${item.number}`);
      } else {
        core.info(`❌ SKIPPING: Issue/PR #${item.number} does not meet criteria for commenting (inactive for ${daysSinceLastUser.toFixed(1)} days).`);
        if (!inactivityCondition) {
          core.info(`  - Reason: Issue/PR is not inactive long enough (${daysSinceLastUser.toFixed(1)} days < ${daysInactive} days required)`);
        }
        if (!botActivityCondition) {
          core.info(`  - Reason: Bot already commented after the last user activity`);
        }
      }
      
      core.info(`-----------------------------------------`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unknown error occurred.");
    }
  }
}

run();