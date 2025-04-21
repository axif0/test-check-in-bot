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

    // Log all inputs received by the action
    core.info('=== DEBUGGING INPUT VALUES ===');
    core.info(`days-inactive (raw): "${core.getInput("days-inactive")}"`);
    core.info(`days-inactive (parsed): ${daysInactive}`);
    core.info(`check-in-message: "${checkInMessage}"`);
    core.info(`comment-message: "${commentMessage}"`);
    core.info(`bot-username: "${botUsername}"`);
    core.info(`ignore-label: "${ignoreLabel}"`);
    core.info('=== END DEBUGGING INPUT VALUES ===');

    // Set up Octokit
    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;

    // Search for open issues and PRs without the ignore label
    const query = `repo:${owner}/${repo} is:open -label:${ignoreLabel}`;
    const searchResponse = await octokit.paginate(octokit.search.issuesAndPullRequests, {
      q: query,
      per_page: 100,
    });

    const now = new Date();

    for (const item of searchResponse) {
      // Fetch all comments for the issue or PR
      const comments = await octokit.paginate(octokit.issues.listComments, {
        owner,
        repo,
        issue_number: item.number,
        per_page: 100,
      });

      // Log all comment authors for debugging
      core.info(`Issue/PR #${item.number} comment authors: ${comments.map(c => c.user?.login).join(", ")}`);

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

      // Check if a comment should be posted
      const shouldComment =
        daysSinceLastUser >= daysInactive &&
        (lastBotActivity === null || 
         (now.getTime() - lastBotActivity.getTime()) / (1000 * 60 * 60 * 24) >= daysInactive);

      if (shouldComment) {
        // Start with the comment message template
        let finalMessage = commentMessage;
        
        // Log the initial state
        core.info(`Initial message: "${finalMessage}"`);
        
        // Super-simple replacement: Try different formats of the template variables
        const checkInVars = ["{{ check-in-message }}", "{{check-in-message}}", "{{ check-in-message}}", "{{check-in-message }}"];
        const daysInactiveVars = ["{{ days-inactive }}", "{{days-inactive}}", "{{ days-inactive}}", "{{days-inactive }}"];
        
        // Try all possible formats for check-in-message
        let replaced = false;
        for (const checkInVar of checkInVars) {
          if (finalMessage.includes(checkInVar)) {
            finalMessage = finalMessage.replace(checkInVar, checkInMessage);
            core.info(`Replaced "${checkInVar}" with check-in message`);
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          core.info("Could not find check-in-message template variable to replace");
        }
        
        // Try all possible formats for days-inactive
        replaced = false;
        for (const daysInactiveVar of daysInactiveVars) {
          if (finalMessage.includes(daysInactiveVar)) {
            finalMessage = finalMessage.replace(daysInactiveVar, daysInactive.toString());
            core.info(`Replaced "${daysInactiveVar}" with days inactive value: ${daysInactive}`);
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          core.info("Could not find days-inactive template variable to replace");
        }
        
        core.info(`Final message after replacements: "${finalMessage}"`);
        
        // Post the comment
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: item.number,
          body: finalMessage,
        });
      } else {
        core.info(`Skipping comment on issue/PR #${item.number}: daysSinceLastUser=${daysSinceLastUser.toFixed(2)}, lastBotActivity=${lastBotActivity ? lastBotActivity.toISOString() : 'null'}`);
      }
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
 