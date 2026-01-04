import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { TaskTreeProvider } from './taskTree';


const API_BASE = 'http://127.0.0.1:8000';


const LOG_REFRESH_INTERVAL_MS = 2000;
const activeLogTimers = new Map<number, NodeJS.Timeout>();


function extractTask(text: string): string | null {
	const prefix = /^Create task:\s*/i;
	if (!prefix.test(text)) return null;
	return text.replace(prefix, '').trim();
}

async function submitTask(description: string) {
	const res = await fetch(`${API_BASE}/tasks`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ description })
	});

	if (!res.ok) {
		throw new Error(`API error: ${res.status}`);
	}
}

async function fetchTaskLogs(taskId: number): Promise<string[]> {
	const res = await fetch(`${API_BASE}/tasks/${taskId}/logs`);
	const data = await res.json();
	return data.logs || [];
}

async function fetchTaskOutputs(taskId: number): Promise<string[]> {
	const res = await fetch(`${API_BASE}/tasks/${taskId}/outputs`);
	const data = await res.json();
	return data.outputs || [];
}

async function cancelTask(taskId: number) {
	await fetch(`${API_BASE}/tasks/${taskId}/cancel`, { method: 'POST' });
}

async function retryTask(taskId: number) {
	await fetch(`${API_BASE}/tasks/${taskId}/retry`, { method: 'POST' });
}


export function activate(context: vscode.ExtensionContext) {

	const disposable = vscode.commands.registerCommand(
		'assistant.sendClipboardAsTask',
		async () => {
			const clipboard = (await vscode.env.clipboard.readText()).trim();

			if (!clipboard) {
				vscode.window.showErrorMessage('Clipboard is empty');
				return;
			}

			const task = extractTask(clipboard);
			if (!task) {
				vscode.window.showErrorMessage(
					'Clipboard must start with "Create task:"'
				);
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				`Submit this task to the autonomous assistant?\n\n${task}`,
				{ modal: true },
				'Submit'
			);

			if (confirm !== 'Submit') return;

			try {
				await submitTask(task);
				vscode.window.showInformationMessage('Task submitted');
			} catch (err: any) {
				vscode.window.showErrorMessage(err.message);
			}
		}
	);

	context.subscriptions.push(disposable);

	const taskTreeProvider = new TaskTreeProvider();

	// Auto-refresh tasks list every 5 seconds
	const TASK_REFRESH_INTERVAL_MS = 3000;

	const refreshInterval = setInterval(() => {
		taskTreeProvider.refresh();
	}, TASK_REFRESH_INTERVAL_MS);

	vscode.window.registerTreeDataProvider(
		'assistantTasks',
		taskTreeProvider
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'assistant.refreshTasks',
			() => taskTreeProvider.refresh()
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'assistant.viewTaskLogs',
			async (taskItem: any) => {
				const taskId = taskItem?.task?.id;
				if (!taskId) {
					vscode.window.showErrorMessage('No task selected.');
					return;
				}

				const document = await vscode.workspace.openTextDocument({
					content: '(Loading logs...)',
					language: 'log',
				});

				const editor = await vscode.window.showTextDocument(document, {
					preview: false,
				});

				const refreshLogs = async () => {
					try {
						const logs = await fetchTaskLogs(taskId);
						const text = logs.length ? logs.join('\n') : '(No logs yet)';
						const edit = new vscode.WorkspaceEdit();
						edit.replace(
							document.uri,
							new vscode.Range(
								document.positionAt(0),
								document.positionAt(document.getText().length)
							),
							text
						);
						await vscode.workspace.applyEdit(edit);
					} catch (err) {
						// Silent fail; next tick may succeed
					}
				};

				// Initial load
				await refreshLogs();

				// Start auto-refresh
				const timer = setInterval(refreshLogs, LOG_REFRESH_INTERVAL_MS);
				activeLogTimers.set(taskId, timer);

				// Stop refreshing when the tab is closed
				const closeListener = vscode.workspace.onDidCloseTextDocument(
					(closedDoc) => {
						if (closedDoc === document) {
							const t = activeLogTimers.get(taskId);
							if (t) clearInterval(t);
							activeLogTimers.delete(taskId);
							closeListener.dispose();
						}
					}
				);

				context.subscriptions.push(closeListener);
			}
		)
	);


	context.subscriptions.push({
		dispose: () => clearInterval(refreshInterval)
	});

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'assistant.openTaskResult',
			async (taskItem: any) => {
				const taskId = taskItem?.task?.id;
				if (!taskId) {
					vscode.window.showErrorMessage('No task selected.');
					return;
				}

				const outputs = await fetchTaskOutputs(taskId);

				if (!outputs.length) {
					vscode.window.showInformationMessage(
						'No output files detected for this task.'
					);
					return;
				}

				const picked = await vscode.window.showQuickPick(
					outputs,
					{ placeHolder: 'Select output file to open' }
				);

				if (!picked) return;

				const uri = vscode.Uri.file(
					`/home/nishant/assistant/tasks/task-${taskId}/${picked}`
				);


				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc);
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'assistant.cancelTask',
			async (taskItem: any) => {
				const taskId = taskItem?.task?.id;
				if (!taskId) return;

				const confirm = await vscode.window.showWarningMessage(
					`Cancel task #${taskId}?`,
					{ modal: true },
					'Cancel Task'
				);

				if (confirm) {
					await cancelTask(taskId);
				}
			}
		),

		vscode.commands.registerCommand(
			'assistant.retryTask',
			async (taskItem: any) => {
				const taskId = taskItem?.task?.id;
				if (!taskId) return;

				const confirm = await vscode.window.showWarningMessage(
					`Retry task #${taskId}?`,
					{ modal: true },
					'Retry Task'
				);

				if (confirm) {
					await retryTask(taskId);
				}
			}
		)
	);

}

export function deactivate() {
	for (const timer of activeLogTimers.values()) {
		clearInterval(timer);
	}
	activeLogTimers.clear();
}

