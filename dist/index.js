"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const rest_1 = require("@octokit/rest");

function run() {
  return __awaiter(this, void 0, void 0, function* () {
    try {
      // Get inputs
      const token = core.getInput("repo-token");
      // const daysInactive = parseInt(core.getInput("days-inactive"), 10);
      const daysInactive = parseFloat(core.getInput("days-inactive"));
      const commentMessage = core.getInput("comment-message");
      const botUsername = core.getInput("bot-username");
      const ignoreLabel = core.getInput("ignore-label") || "ignore-checkin";

      // Set up Octokit
      const octokit = new rest_1.Octokit({ auth: token });
      const { owner, repo } = github.context.repo;

      // Search for open issues and PRs without the ignore label
      const query = `repo:${owner}/${repo} is:open -label:${ignoreLabel}`;
      const items = yield octokit.paginate(octokit.search.issuesAndPullRequests, {
        q: query,
        per_page: 100,
      });

      const now = new Date();

      for (const item of items) {
        // Fetch all comments for the issue or PR
        const comments = yield octokit.paginate(octokit.issues.listComments, {
          owner,
          repo,
          issue_number: item.number,
          per_page: 100,
        });

        // Find last user activity (most recent non-bot comment or issue creation)
        const userComments = comments.filter((c) => c.user.login !== botUsername);
        let lastUserActivity = userComments.length > 0
          ? new Date(Math.max(...userComments.map((c) => new Date(c.created_at).getTime())))
          : new Date(item.created_at);

        // Find last bot activity (most recent bot comment, if any)
        const botComments = comments.filter((c) => c.user.login === botUsername);
        const lastBotActivity = botComments.length > 0
          ? new Date(Math.max(...botComments.map((c) => new Date(c.created_at).getTime())))
          : null;

        // Calculate days since last user activity
        const daysSinceLastUser = (now.getTime() - lastUserActivity.getTime()) / (1000 * 60 * 60 * 24);

        // Check if a comment should be posted
        const shouldComment =
          daysSinceLastUser >= daysInactive &&
          (lastBotActivity === null || lastBotActivity < lastUserActivity);

        if (shouldComment) {
          // Post the comment
          yield octokit.issues.createComment({
            owner,
            repo,
            issue_number: item.number,
            body: commentMessage,
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
  });
}

run();