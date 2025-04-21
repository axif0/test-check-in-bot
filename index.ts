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
        // Process template variables in comment message
        let finalMessage = commentMessage;
        
        // Debug logging
        core.info(`Original comment message: "${commentMessage}"`);
        core.info(`Check-in message value: "${checkInMessage}"`);
        core.info(`Days inactive value: ${daysInactive}`);
        
        // Function to replace template variables with better logging
        const replaceTemplateVar = (text: string, varName: string, value: string): string => {
          const regex = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`, 'g');
          const matches = text.match(regex);
          const count = matches ? matches.length : 0;
          core.info(`Looking for template variable "${varName}" - found ${count} matches`);
          
          return text.replace(regex, value);
        };
        
        // Replace template variables with the new function
        finalMessage = replaceTemplateVar(finalMessage, 'days-inactive', daysInactive.toString());
        finalMessage = replaceTemplateVar(finalMessage, 'inputs\\.check-in-message', checkInMessage);
        finalMessage = replaceTemplateVar(finalMessage, 'check-in-message', checkInMessage);
        
        // Add a fallback for any remaining template vars
        const remainingTemplates = finalMessage.match(/\{\{[^}]+\}\}/g);
        if (remainingTemplates) {
          core.info(`WARNING: Found unprocessed template variables: ${remainingTemplates.join(', ')}`);
          
          // Dump the exact characters for debugging
          for (const template of remainingTemplates) {
            core.info(`Unprocessed template: ${[...template].map(c => c.charCodeAt(0)).join(',')}`);
          }
        }
        
        core.info(`Final processed comment message: "${finalMessage}"`);
        
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
 