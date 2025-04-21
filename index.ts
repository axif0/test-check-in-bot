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

      // Check if a comment should be posted:
      // 1. User activity is older than the inactive threshold
      // 2. Bot hasn't commented yet OR the last user activity is more recent than last bot activity
      const shouldComment = 
        daysSinceLastUser >= daysInactive &&
        (lastBotActivity === null || lastUserActivity > lastBotActivity);

      if (shouldComment) {
        // Start with the comment message template
        let finalMessage = commentMessage;
        
        // Super-simple replacement: Try different formats of the template variables
        const checkInVars = ["{{ check-in-message }}", "{{check-in-message}}", "{{ check-in-message}}", "{{check-in-message }}"];
        const daysInactiveVars = ["{{ days-inactive }}", "{{days-inactive}}", "{{ days-inactive}}", "{{days-inactive }}"];
        
        // Try all possible formats for check-in-message with global replacement
        for (const checkInVar of checkInVars) {
          if (finalMessage.includes(checkInVar)) {
            // Use split/join for global replacement
            finalMessage = finalMessage.split(checkInVar).join(checkInMessage);
            break;
          }
        }
        
        // Try all possible formats for days-inactive with global replacement
        for (const daysInactiveVar of daysInactiveVars) {
          if (finalMessage.includes(daysInactiveVar)) {
            // Use split/join for global replacement
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
 