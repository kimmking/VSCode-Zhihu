import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as md5 from "md5";
import * as OSS from "ali-oss";
import { ShellScriptPath } from "../const/PATH";
import { ImageUpload, ImageHostAPI } from "../const/URL";
import { HttpService } from "./http.service";
import { ZhihuOSSAgent } from "../const/HTTP";
import { IImageUploadToken } from "../model/publish/image.model"
import { LegalImageExt } from "../const/ENUM";


export class PasteService {

	constructor(
		protected context: vscode.ExtensionContext,
		protected httpService: HttpService
	) {
	}
	/**
	 * ## @zhihu.uploadImageFromClipboard
	 * @param imagePath path to be pasted. use default if not set.
	 * @return object_name generated by OSS
	 */
	public uploadImageFromClipboard() {
		console.log('Hello')
		let imagePath = path.join(this.context.extensionPath, 'image.png');
		this.saveClipboardImageToFileAndGetPath(imagePath, () => {
			this._uploadImageFromPath(imagePath);
		})
	}

	public async uploadImageFromExplorer(uri?: vscode.Uri) {
		let imageUri = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: {
				'Images': ['png', 'jpg', 'gif']
			}, 	
			openLabel: '选择要上传的图片：'
		}).then(uris => uris ? uris[0] : undefined);
		this._uploadImageFromPath(imageUri.fsPath);
	}

	/**
	 * upload file specified by `filePath` to zhihu OSS provided by aliyun
	 * @param filePath path of file to be uploaded, use path from clipboard if not provided.
	 * @return a promise to resolve the generated object_name on OSS.
	 */
	private async _uploadImageFromPath(filePath: string): Promise<string> {
		let zhihu_agent = ZhihuOSSAgent;

		let hash = md5(fs.readFileSync(filePath))

		var options = {
			method: "POST",
			uri: ImageUpload,
			body: {
				image_hash: hash,
				source: "answer"
			},
			headers: {},
			json: true,
			resolveWithFullResponse: true,
			simple: false
		};

		let prefetchResp = await this.httpService.sendRequest(options)
		if (prefetchResp.statusCode == 401) {
			vscode.window.showWarningMessage('登录之后才可上传图片！');
			return;
		}
		let prefetchBody: IImageUploadToken = prefetchResp.body;
		let upload_file = prefetchBody.upload_file;
		if (prefetchBody.upload_token) {
			zhihu_agent.options.accessKeyId = prefetchBody.upload_token.access_id;
			zhihu_agent.options.accessKeySecret = prefetchBody.upload_token.access_key;
			zhihu_agent.options.stsToken = prefetchBody.upload_token.access_token;
			let client = new OSS(zhihu_agent.options);
			console.log(prefetchBody);
			this.insertImageLink(`${prefetchBody.upload_file.object_key}${path.extname(filePath)}`);
			// object表示上传到OSS的Object名称，localfile表示本地文件或者文件路径
			let putResp = client.put(upload_file.object_key, filePath);
			console.log(putResp)
		} else {
			this.insertImageLink(`v2-${hash}${path.extname(filePath)}`);
		}
		vscode.window.showInformationMessage('上传成功！')
		return Promise.resolve(prefetchBody.upload_file.object_key);
	}

	/**
	 * ### @zhihu.uploadImageFromPath
	 * 
	 */
	public async uploadImageFromPath(uri?: vscode.Uri) {
		let _path:string;
		if (uri) {
			_path = uri.fsPath; 
		} else {
			_path = await vscode.env.clipboard.readText();
		}
		if (LegalImageExt.includes(path.extname(_path))) {
			if (path.isAbsolute(_path)) {
				this._uploadImageFromPath(_path);
			} else {
				let workspaceFolders = vscode.workspace.workspaceFolders;
				if (workspaceFolders) {
					this._uploadImageFromPath(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, _path));
				} else {
					vscode.window.showWarningMessage('上传图片前请先打开一个文件夹！');
				}
			}
		} else {
			vscode.window.showWarningMessage(`不支持的文件类型！${path.extname(_path)}\n\
			仅支持上传 ${LegalImageExt.toString()}`)
		}
	}

	/**
	 * Insert Markdown inline image in terms of filename
	 * @param filename 
	 */
	private insertImageLink(filename: string) {
		let editor = vscode.window.activeTextEditor;
		let uri = editor.document.uri;
		if (uri.scheme === 'untitled') {
			vscode.window.showWarningMessage('请先保存当前编辑文件！');
			return;
		}
		editor.edit(e => {
			let current = editor.selection;
			e.insert(current.start, `![Image](${ImageHostAPI}/${filename})`);
		})

	}

	private saveClipboardImageToFileAndGetPath(imagePath: string, cb: () => void) {
		if (!imagePath) return;

		let platform = process.platform;
		if (platform === 'win32') {
			// Windows
			const scriptPath = path.join(this.context.extensionPath, ShellScriptPath, 'pc.ps1');

			let command = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
			let powershellExisted = fs.existsSync(command)
			if (!powershellExisted) {
				command = "powershell"
			}

			const powershell = childProcess.spawn(command, [
				'-noprofile',
				'-noninteractive',
				'-nologo',
				'-sta',
				'-executionpolicy', 'unrestricted',
				'-windowstyle', 'hidden',
				'-file', scriptPath,
				imagePath
			]);
			powershell.on('error', function (e: Error) {
				vscode.window.showErrorMessage(e.message);
			});
			powershell.on('exit', function (code, signal) {
				// console.log('exit', code, signal);
			});
			powershell.stdout.on('data', function (data: Buffer) {
				cb()
			});
		}
		else if (platform === 'darwin') {
			// Mac
			let scriptPath = path.join(__dirname, ShellScriptPath, 'mac.applescript');

			let ascript = childProcess.spawn('osascript', [scriptPath, imagePath]);
			ascript.on('error', function (e) {
				vscode.window.showErrorMessage(e.message);
			});
			ascript.on('exit', function (code, signal) {
				// console.log('exit',code,signal);
			});
			ascript.stdout.on('data', function (data: Buffer) {
				cb();
			});
		} else {
			// Linux 

			let scriptPath = path.join(__dirname, ShellScriptPath, 'linux.sh');

			let ascript = childProcess.spawn('sh', [scriptPath, imagePath]);
			ascript.on('error', function (e) {
				vscode.window.showErrorMessage(e.message);
			});
			ascript.on('exit', function (code, signal) {
				// console.log('exit',code,signal);
			});
			ascript.stdout.on('data', function (data: Buffer) {
				let result = data.toString().trim();
				if (result == "no xclip") {
					vscode.window.showInformationMessage('You need to install xclip command first.');
					return;
				}
				cb();
			});
		}
	}

}