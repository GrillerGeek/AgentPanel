# AgentPanel user guide

AgentPanel organizes development terminals by repository and Git worktree. Use a separate
worktree for each task or agent so their working files stay separate. Optional Herdr core
support keeps programs running when you close AgentPanel and lets you work on remote machines.

This guide describes the features on `main`. If an installed release does not show the controls
below, use a build containing these features or [build from source](../README.md#build-from-source).
Herdr support is experimental on macOS/Linux and disabled on Windows; Windows users can use
the default local terminals. Herdr integration has native macOS and Linux runtime/SSH test
coverage; physical-machine, WAN, and sleep/wake acceptance remains pending.

## Start with a local project

1. Install AgentPanel using the [platform instructions](../README.md#install). Install Git and
   any agent CLIs you want to use separately.
2. Click **+ Add** in the sidebar and choose a local folder. Git repositories show their
   worktrees; ordinary folders can also have terminals.
3. Select a worktree to open a terminal. Use **+** in the tab bar for another terminal or the
   split button for a second pane. Agent quick-launch buttons run their configured command
   in a new terminal for the active worktree.
4. For a separate task, expand the repository and choose **＋ new worktree**. Enter a branch
   name, choose **based on**, and click **Create**. For local repositories the base choice is
   remembered. The checkout goes in a sibling `<repo>-worktrees/<branch>` directory, with
   slashes in the branch name replaced by hyphens.
5. Use **Diff review** to inspect changes and leave comments, **Notes** for task notes, and
   **Open in editor** for a local checkout. GitHub PR/CI information requires the `gh` CLI.

The default **Local PTY** runtime starts a shell owned by AgentPanel. Closing the app stops
those shells. Session restore can reopen tabs and restore saved terminal text, but that text
is not a running process or an agent conversation resumed in place.

If saved text cannot be restored, the pane shows an error and **Retry**. Its saved archive
stays untouched, and the shell does not start. Resolve the reported problem and retry, or
turn off **Remember terminal scrollback between launches** in Settings, then retry to start
without restoring that text.

## Set up persistent local terminals

1. Install [herdr-core](https://herdr.dev/core/) separately on your computer. AgentPanel does
   not bundle it. The integration was validated with core **0.1.16**; other versions must
   provide the compatible generation 1 API.
2. In a normal terminal, check `hc --version` (or use the executable name your installation
   provides). On macOS/Linux, `command -v hc` gives its path if it is on your shell's PATH.
3. Open AgentPanel **Settings**. Under **Runtime for new local terminals**, select
   **Herdr core (experimental)**.
4. Set **Herdr core executable** to the installed executable name, such as `hc` or
   `herdr-core`, or its full path. Enter only the executable, without command arguments.
   Use a full path if a GUI-launched app cannot find it.
5. Set **Herdr core session** to a dedicated name such as `agentpanel`, then click **Save**.
   Names contain 1–32 letters, numbers, hyphens, or underscores.
6. Create a new terminal. Its status strip identifies the Herdr session. Existing panes keep
   their previous runtime and session; changing Settings affects new local panes.

Quit and reopen AgentPanel to reconnect to the saved program. This is attachment to the same
runtime-owned process; AgentPanel does not replay the agent launch command. A missing program
or changed runtime identity produces an error instead of silently starting a replacement.

Herdr owns persistent terminal history. **Remember terminal scrollback between launches**
controls saved text for Local PTY panes, not Herdr's history. Turning it off or clearing
AgentPanel's saved scrollback does not erase core's history, which can contain terminal output.

## Closing terminals and the app

**Detach** closes AgentPanel's viewer while leaving the program running. **Stop** ends the
program. A terminal can therefore keep running after its tab disappears.

| Terminal type | Close its pane or tab | Quit AgentPanel |
| --- | --- | --- |
| Local PTY, the default | Stops its program | Stops its program |
| Local Herdr terminal created by AgentPanel | Stops its program; a failed stop keeps the tab visible | Detaches; program continues |
| Existing terminal imported through **Machines & terminals**, local or remote | Detaches | Detaches |
| Terminal created for a remote project | Detaches | Detaches |

To stop a remote program, finish or exit it in its terminal. If exiting an agent returns you
to a shell, that shell is still a live program: run `exit` when you are done with it too.
Closing its tab is not a stop command. Use **Machines & terminals** to attach again if you
previously detached. AgentPanel currently has no remote stop/kill button.

Removing a repository with its sidebar **✕** only forgets the app record; it does not delete
the repository or its history. Removing a worktree is a separate action that deletes a
checkout directory after safety checks. For local worktrees, removal stops connected
AgentPanel terminals after confirmation; remote removal follows the rules below.

## Connect a remote machine

You need SSH access to the remote computer and Herdr core there. Configure and authenticate
in a normal terminal before using AgentPanel. AgentPanel does not manage SSH credentials or
complete interactive password, host-key, or MFA prompts.

For example, using the `hc` executable in a macOS/Linux shell, replace `dev@buildbox` with your
SSH target:

```sh
HC_SESSION=agentpanel hc machine add dev@buildbox --name devbox --session agentpanel
HC_SESSION=agentpanel hc machine ls
```

`HC_SESSION=agentpanel` selects the **local** core session that AgentPanel will browse.
`--session agentpanel` selects the **remote** session. `devbox` is the local name for this
machine connection. Herdr may offer to install or update core on the remote host; review that
prompt in your terminal. For login problems and alternative SSH setups, follow the official
[Herdr machine guide](https://github.com/herdrdev/herdr-core/blob/de82c962fa6d2a7780d4e5058fda288c14bd0d8f/docs/machines.md).
Sessions separate terminals and state; they do not restrict the SSH account's permissions.

In AgentPanel:

1. Click **Machines & terminals** in the sidebar.
2. Enter the installed **Herdr executable** and the same **Local core session** (`agentpanel`
   in the example).
3. Click **Refresh terminals**. Check the machine name, remote session, and connection state.
4. If the machine needs login, complete it through Herdr/OpenSSH in your normal terminal,
   then refresh again. For this example: `HC_SESSION=agentpanel hc machine login devbox`.

The browser remembers the last successfully browsed endpoint separately from Settings' default
runtime for new local terminals. Changing that default does not redirect existing remote tabs.
A failed refresh leaves the previous inventory marked stale and disables attachment until a
successful refresh.

To view the same remote programs from another computer, install AgentPanel/core there,
configure SSH access to the same remote host and **remote core session**, and attach through
its machine browser. Programs and files remain on the remote computer. Each viewer uses its
own local core configuration; this does not copy repositories or migrate processes.

## Attach to an existing terminal

In **Machines & terminals**, find a live terminal and click **Attach**. Check its machine,
session, and original directory. An address such as `devbox/t3` identifies a terminal on that
machine; the short ID or path alone may match terminals on other computers.

Attachment is interactive, so input goes to the existing program. Imported tabs are
terminal-only: they do not create a repository record and do not offer project launch,
split, editor, Quick Open, or Git review actions. Add the remote repository separately for
those supported project workflows. Closing an imported tab detaches, including when the
program is on this computer.

## Add a remote repository and launch agents

1. Configure and refresh the remote machine as above.
2. Under its connected machine group, click **Add repository on devbox** (using your machine's
   name).
3. Enter an existing Git working-tree path on that machine, such as `/srv/myapp`, and click
   **Add remote repository**. Use an absolute Unix path, not `~`, an SSH URL, or a local path.
   The repository must already exist; this action does not clone it.
4. The sidebar shows the repository with its machine name and discovers its existing linked
   worktrees. Identical paths on different machines remain separate projects.
5. Select a worktree to create a remote terminal. **+**, split, and agent quick-launch actions
   create programs on that same machine even if your default local runtime is Local PTY.

The remote server chooses the shell and its environment. Your computer's Shell setting,
PATH import, and terminal environment overrides are not forwarded. Install/configure your
agent CLI and authenticate it on the remote machine before quick-launching it there.

Remote Quick Open, local editor launch, and remote GitHub PR lookup are currently unavailable.
Use the remote terminal for file operations; use Git review for the supported diff workflow.

## Review remote Git changes

1. Select a terminal belonging to an added remote project and open **Diff review**.
2. Select a changed file to inspect its patch. Review includes committed branch changes
   relative to the review base, plus working changes and untracked files.
3. Click **Refresh remote diff** after changes. Use **Refresh remote project** in the sidebar
   to rediscover worktrees and refresh status. Status also polls while AgentPanel is visible;
   remote files do not use your computer's local filesystem watcher.

Review uses refs already present on the remote host; it does not fetch from Git remotes.
A new repository without an initial commit can show status, but review diff requires that
first commit. Untracked line counts are unavailable until inspection; binary files show a
non-text notice, and symlink patches show the link target. If a query fails, the UI reports
unavailable data rather than claiming that the checkout is clean.

## Create a remote worktree

1. Expand the remote repository and click **＋ new worktree**.
2. Enter a **new** branch name, such as `feature/search`, and choose **based on** from the
   branches already present on that remote repository.
3. Check the displayed destination and machine, then click **Create**. For `/srv/myapp`, this
   example creates `/srv/myapp-worktrees/feature-search` and opens a remote terminal there.

Existing branches and existing destination directories, including empty ones, are refused.
Names that flatten to the same directory also collide: `feature/search` and `feature-search`
cannot use the same destination. Remote base selections are not remembered for next time.
Use trusted repositories: Git hooks are disabled for these checkout operations, but configured
checkout filters may run on the remote host.

If creation fails or times out, refresh the project and inspect remote state before trying
again. A branch, directory, or checkout may already have been created. AgentPanel does not
retry or roll back a potentially completed operation automatically.

## Remove a remote worktree

1. Save or move everything you want to keep, including ignored files such as local `.env`
   files or generated artifacts. Commit/stash as appropriate; an ordinary stash may omit
   untracked or ignored files.
2. Exit **all programs in that machine's selected Herdr session**, even programs in another
   checkout or a detached tab. Exit an agent and its parent shell; closing a tab only detaches.
   Use the machine browser to find and reattach detached programs. Programs on a different
   machine do not block removal.
3. Stop other editors/tools using the checkout, including other core sessions or app instances.
4. Click the **✕** beside the linked worktree, not the repository's **✕**.
5. Review the machine and full path in the confirmation. Choose **Cancel** to keep everything,
   or **Remove remote worktree** to remove the clean checkout. Its branch is retained.

AgentPanel rejects primary, detached, locked, or missing worktrees, and checkouts containing
modified, staged, untracked, or ignored files. A detached checkout needs a branch first so
its history remains referenced. File and program checks run again after confirmation. Ended
viewers and checkout notes are cleared only after successful removal.

Removal uses Git without force or recursive-deletion fallback. Checks coordinate this app's
new remote terminals and worktree operations, but cannot exclude independent clients or
unmanaged processes from editing the files. After any timeout or uncertain result, refresh
and inspect the checkout before retrying.

## Reconnect and troubleshoot

Saved remote tabs remain visible when a host is offline. Restore does not wait for remote
repository discovery before opening viewers on healthy hosts. Once connectivity returns,
refresh the machine/project as needed and use the terminal's **Reconnect** button. Reconnect
validates the saved runtime and program identity; it never starts a replacement or replays
an agent launch after a remote creation attempt.

| What you see | What to do |
| --- | --- |
| Executable not found | Use the installed executable's full path in Settings or the machine browser. Enter no arguments. |
| Machine absent from the browser | Check that the CLI's `HC_SESSION` and the browser's **Local core session** match, then refresh. |
| Needs login, disconnected, or stale inventory | Complete SSH/Herdr login in a normal terminal, restore connectivity, then refresh and reconnect. |
| Changed core/machine identity or saved terminal not found | Verify the selected endpoint and session. Refresh the browser to attach explicitly to a current program. To start a new program deliberately, close the old tab and select its added project worktree again. |
| Status not reported | The program has not reported activity to core. This is normal for ordinary shells; silence does not establish completion. |
| Worktrees/status/diff unavailable | Restore connectivity and refresh. Retained inventory may be stale; unavailable status does not mean clean. |
| Remote worktree removal blocked by programs | Attach to and exit every remaining program in that machine's selected session. Detached tabs still count. |
| Removal blocked by files or locks | Preserve the files first, or resolve the lock deliberately on the remote host. AgentPanel does not override these checks. |
| Creation/removal timeout or output/size limit | Refresh and inspect remote state before retrying a mutation. Large/slow repositories can exceed the prototype's command and display limits. |
| Quick-launch command missing remotely | Install/configure the CLI on the remote machine. Local PATH and environment overrides do not apply. |

For a bug report, include the AgentPanel/core versions, OS, runtime type, action, and error
message. Redact credentials, private paths, and terminal output before sharing.
