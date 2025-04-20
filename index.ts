import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";

async function run() {
  try {
    // Get inputs
    const token = core.getInput("repo-token");
    const daysInactive = parseInt(core.getInput("days-inactive"), 10);
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
        // Replace placeholders in commentMessage
        let finalMessage = commentMessage
          .replace(/\{\{\s*check-in-message\s*\}\}/g, checkInMessage)
          .replace(/\{\{\s*days-inactive\s*\}\}/g, daysInactive.toString());

        // Log decision to post comment
        core.info(`Posting comment on issue/PR #${item.number}: daysSinceLastUser=${daysSinceLastUser.toFixed(2)}, lastBotActivity=${lastBotActivity ? lastBotActivity.toISOString() : 'null'}`);
        core.info(`Comment content: ${finalMessage}`);
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
 