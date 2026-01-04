import * as vscode from 'vscode';
import fetch from 'node-fetch';

const API_BASE = 'http://127.0.0.1:8000';

export interface Task {
    id: number;
    description: string;
    status: string;
}

export class TaskItem extends vscode.TreeItem {
    constructor(public readonly task: Task) {
        super(
            `#${task.id} — ${task.status}`,
            vscode.TreeItemCollapsibleState.None
        );

        this.description = task.description;
        this.contextValue = `assistantTask.${task.status}`;

        this.command = {
            command: 'assistant.viewTaskLogs',
            title: 'View Task Logs',
            arguments: [this],
        };
    }
}

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskItem> {

    private _onDidChangeTreeData =
        new vscode.EventEmitter<TaskItem | undefined | null | void>();

    readonly onDidChangeTreeData =
        this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<TaskItem[]> {
        const res = await fetch(`${API_BASE}/tasks`);
        const tasks: Task[] = await res.json();

        return tasks.map(task => new TaskItem(task));
    }
}
