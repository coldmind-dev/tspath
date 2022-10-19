/*=--------------------------------------------------------------=

 TSPath - Typescript Path Resolver

 Author : Patrik Forsberg
 Email  : patrik.forsberg@coldmind.com
 GitHub : https://github.com/duffman

 I hope this piece of software brings joy into your life, makes
 you sleep better knowing that you are no longer in path hell!

 Use this software free of charge, the only thing I ask is that
 you obey to the terms stated in the license, i would also like
 you to keep the file header intact.

 Also, I would love to see you getting involved in the project!

 Enjoy!

 This software is subject to the LGPL v2 License, please find
 the full license attached in LICENCE.md

 =----------------------------------------------------------------= */

let esprima   = require("esprima");
let escodegen = require("escodegen");
const chalk   = require("ansi-colors");

import { Const }               from "./tspath.const";
import { Logger }              from "./utils/logger";
import { PathUtils }           from "./utils/path.utils";
import { Utils }               from "./utils/utils";
import { JsonCommentStripper } from "./utils/json-comment-stripper";
import { ProjectOptions }      from "./project-options";
import * as fs                 from "fs";
import * as path               from "path";
import { DinaLogger }          from "dina-common";

const log     = console.log;
const testRun = false;

export class ParserEngine {
	public projectPath: string;

	nrFilesProcessed: number = 0;
	nrPathsProcessed: number = 0;
	srcRoot: string;
	basePath: string;
	distRoot: string;
	compactMode: boolean     = true;
	projectOptions: ProjectOptions;
	tsConfig: any;
	fileFilter: Array<string>;

	constructor(public dryRun?: boolean) {
	}

	public exit(code: number = 5) {
		console.log("Terminating...");
		process.exit(code);
	}

	/**
	 * Assign project path
	 * @param {string} projectPath
	 * @returns {boolean}
	 */
	public setProjectPath(projectPath: string): boolean {
		if (!Utils.isEmpty(projectPath) && !this.validateProjectPath(projectPath)) {
			log(chalk.red.bold("Project Path \"" + chalk.underline(projectPath) + "\" is invalid!"));
			return false;
		}

		this.projectPath = projectPath;

		return true;
	}

	/**
	 * Set the accepted file extensions, ensure leading . (dot)
	 * @param {Array<string>} filter
	 */
	public setFileFilter(filter: Array<string>) {
		this.fileFilter = filter.map((e) => {
			return !e.startsWith(".") ? "." + e : e;
		});
	}

	private validateProjectPath(projectPath: string): boolean {
		let result = true;

		let configFile = Utils.ensureTrailingSlash(projectPath);
		configFile += Const.TS_CONFIG;

		if (!fs.existsSync(projectPath)) {
			result = false;
		}

		if (!fs.existsSync(configFile)) {
			log("TypeScript Compiler - Configuration file " + chalk.underline(Const.TS_CONFIG) + " is missing!");
		}

		return result;
	}

	/**
	 * Attempts to read the name property form package.json
	 * @returns {string}
	 */
	private readProjectName(): string {
		let projectName: string = null;
		let filename            = path.resolve(this.projectPath, "package.json");

		if (fs.existsSync(filename)) {
			let json    = require(filename);
			projectName = json.name;
		}

		return projectName;
	}

	/**
	 * Parse project and resolve paths
	 */
	public async execute(): Promise<void> {
		const PROCESS_TIME = "Operation finished in";
		console.time(PROCESS_TIME);

		if (!this.validateProjectPath(this.projectPath)) {
			log(chalk.bold.red("Invalid project path!"));
			this.exit(10);
		}

		this.projectOptions = this.readConfig();
		let projectName     = this.readProjectName();

		if (!Utils.isEmpty(projectName)) {
			log(chalk.yellow("Parsing project: ") + chalk.bold(projectName) + " " + chalk.underline(this.projectPath));
		}
		else {
			log(chalk.yellow.bold("Parsing project at: ") + "\"" + this.projectPath + "\"");
		}

		this.distRoot = path.resolve(this.projectPath, this.projectOptions.outDir);
		this.basePath = this.distRoot;

		let tmpPath = path.resolve(this.distRoot, this.projectOptions.baseUrl);

		//
		// If the baseUrl exist in the dist folder, the TS Compiler have re-used the src structure
		// in the dist folder in order to keep the structure intact, probably due to a require to
		// a file located directly in the project root folder
		//
		if (( this.projectOptions.baseUrl !== this.projectOptions.outDir ) && PathUtils.pathExist(tmpPath)) {
			this.basePath = tmpPath;
		}

		if (Const.DEBUG_MODE) {
			//console.clear();
			console.log("TMP :::", tmpPath);
			console.log("Project path ::", this.projectPath);
			console.log("Dist path ::", this.distRoot);
			console.log("Src path ::", this.srcRoot);
		}

		let fileList = new Array<string>();

		Logger.logPurple("Indexing files...");
		console.log(this.distRoot);

		this.walkSync(this.distRoot, fileList, ".js");

		for (let i = 0; i < fileList.length; i++) {
			let filename = fileList[ i ];

			// @ts-ignore
			process.stdout.clearLine();
			// @ts-ignore
			process.stdout.cursorTo(0);
			process.stdout.write(`Processing file "${ path.basename(filename) }"...` + "\r");
			if (Const.DEBUG_MODE) await Utils.sleep(150);
			this.processFile(filename);

			// @ts-ignore
			process.stdout.clearLine();
		}

		log(chalk.bold("Total files processed:"), this.nrFilesProcessed);
		log(chalk.bold("Total paths processed:"), this.nrPathsProcessed);

		console.timeEnd(PROCESS_TIME);
		log(chalk.bold.green("Project is prepared, now run it normally!"));
	}

	private shouldSkipFile(filename: string): boolean {
		const contents = fs.readFileSync(filename, Const.FILE_ENCODING) as string;
		return contents.includes("tspath:skip-file");
	}

	/**
	 *
	 * @param sourceFilename
	 * @param jsRequire - require in javascript source "require("jsRequire")
	 * @returns {string}
	 */
	getRelativePathForRequiredFile(sourceFilename: string, jsRequire: string) {
		let options = this.projectOptions;

		if (Const.DEBUG_MODE) {
			console.log("FIRST :: jsRequire ::", jsRequire);
			console.log("getRelativePathForRequiredFile ::---", sourceFilename);
		}

		for (let alias in options.pathMappings) {
			let mapping = options.pathMappings[ alias ];

			//TODO: Handle * properly
			alias   = Utils.stripWildcard(alias);
			mapping = Utils.stripWildcard(mapping);

			// 2018-06-02: Workaround for bug with same prefix Aliases e.g @db and @dbCore
			// Cut alias prefix for mapping comparison
			let requirePrefix = jsRequire.substring(0, jsRequire.indexOf(path.sep));

			if (requirePrefix === alias) {
				Logger.debug("jsRequire ::", jsRequire);
				Logger.debug("requirePrefix ::", requirePrefix);
				Logger.debug("alias ::", alias);
				Logger.debug("---");

				let result = jsRequire.replace(alias, mapping);
				Utils.replaceDoubleSlashes(result);

				let absoluteJsRequire = path.join(this.basePath, result);
				Logger.debug("Absolute PATH require ::", absoluteJsRequire);

				/*
				 if (!fs.existsSync(`${ absoluteJsRequire }.js`)) {
				 const newResult   = jsRequire.replace(alias, "");
				 absoluteJsRequire = path.join(this.basePath, newResult);
				 }
				 */
				let sourceDir = path.dirname(sourceFilename);

				if (Const.DEBUG_MODE) {
					console.log("this.distRoot == ", this.distRoot);
					console.log("sourceDir == ", sourceDir);
					console.log("absoluteJsRequire == ", absoluteJsRequire);
					console.log("sourceFilename == ", sourceFilename);
				}

				let fromPath = path.dirname(sourceFilename);

				//	fromPath = Utils.ensureTrailingPathDelimiter(fromPath)

				let toPath = path.dirname(absoluteJsRequire);

				// let relativePath = PathUtils.getRelativePath(fromPath, toPath, true);

				let relativePath = path.relative(fromPath, toPath);

				Logger.debug("Relative PATH ::", relativePath);

				if (!relativePath.trim().length) {
					relativePath = ".";
				}

				relativePath = Utils.ensureTrailingSlash(relativePath);

				//
				// If the path does not start with .. it´ not a sub directory
				// as in ../ or ..\ so assume it´ the same dir...
				//
				if (relativePath[ 0 ] !== ".") {
					relativePath = "./" + relativePath;
				}

				Logger.debug("BEFORE >>>>>>>>>>>>>>> ::", absoluteJsRequire);

				jsRequire = relativePath + path.parse(absoluteJsRequire).base;

				Logger.debug("AFTER >>>>>>>>>>>>>>> ::", jsRequire);

				break;
			}
		}

		return jsRequire;
	}

	/**
	 * Processes the filename specified in require("filename")
	 * @param node
	 * @param sourceFilename
	 * @returns {any}
	 */
	processJsRequire(node: any, sourceFilename: string): any {
		let resultNode      = node;
		let requireInJsFile = Utils.safeGetAstNodeValue(node);

		//
		// Only proceed if the "require" contains a full file path, not
		// single references like "inversify"
		//
		if (!Utils.isEmpty(requireInJsFile) && Utils.fileHavePath(requireInJsFile)) {
			let relativePath = this.getRelativePathForRequiredFile(sourceFilename, requireInJsFile);
			resultNode       = { type: "Literal", value: relativePath, raw: relativePath };

			if (relativePath && relativePath.length)
				this.nrPathsProcessed++;
		}

		return resultNode;
	}

	/**
	 * Extracts all the requires from a single file and processes the paths
	 * @param filename
	 */
	processFile(filename: string) {
		this.nrFilesProcessed++;

		let scope           = this;
		let inputSourceCode = fs.readFileSync(filename, "utf-8");
		let ast             = null;

		try {
			ast = esprima.parse(inputSourceCode, { raw: true, tokens: true, range: true, comment: true });
		}
		catch (error) {
			Logger.logRed("Unable to parse file:", filename);

			console.log("Source ::",
						inputSourceCode,
			);

			Logger.log("Error:", error);
			this.exit();
		}

		this.traverseSynTree(ast, this, (node) => {
			if (node != undefined && node.type == "CallExpression" && node.callee.name == "require") {
				node.arguments[ 0 ] = scope.processJsRequire(node.arguments[ 0 ], filename);
			}
		});

		let option      = { comment: true, format: { compact: this.compactMode, quotes: `"` } };
		let finalSource = escodegen.generate(ast, option);

		try {
			if (!testRun) {
				this.saveFileContents(filename, finalSource);
			}
		}
		catch (error) {
			Logger.logRed(`Unable to write file: "${ filename }"`);
			this.exit();
		}
	}

	/**
	 * Saves file contents to disk
	 * @param filename
	 * @param fileContents
	 */
	public saveFileContents(filename: string, fileContents: string): boolean {
		try {
			fs.writeFileSync(filename, fileContents, Const.FILE_ENCODING);
			return true;
		}
		catch (e) {
			throw Error(`Error while saving file "Could not save file "${ filename }"`);
		}
	}

	/**
	 * Read and parse the TypeScript configuration file
	 * @param configFilename
	 */
	readConfig(configFilename: string = Const.TS_CONFIG): ProjectOptions {
		let fileName = path.resolve(this.projectPath, configFilename);
		fileName     = path.resolve(this.projectPath, fileName);
		let fileData = fs.readFileSync(fileName, Const.FILE_ENCODING);

		let jsonCS = new JsonCommentStripper();
		fileData   = jsonCS.stripComments(fileData);

		try {
			this.tsConfig = JSON.parse(fileData);
		}
		catch (e) {
			Logger.error(`JSON parser failed for file "${ fileName }"`);
		}

		let compilerOpt = this.tsConfig.compilerOptions;

		let reqFields          = [];
		reqFields[ "baseUrl" ] = compilerOpt.baseUrl;
		reqFields[ "outDir" ]  = compilerOpt.outDir;

		for (let key in reqFields) {
			let field = reqFields[ key ];
			if (Utils.isEmpty(field)) {
				log(chalk.red.bold("Missing required field:") + " \"" + chalk.bold.underline(key) + "\"");
				this.exit(22);
			}
		}

		return new ProjectOptions(compilerOpt);
	}

	/**
	 * Traverse parsed JavaScript
	 * @param ast
	 * @param scope
	 * @param func
	 */
	private traverseSynTree(ast, scope, func): void {
		func(ast);
		for (let key in ast) {
			if (ast.hasOwnProperty(key)) {
				let child = ast[ key ];

				if (typeof child === "object" && child !== null) {
					if (Array.isArray(child)) {
						child.forEach(function(ast) {
							//5
							scope.traverseSynTree(ast, scope, func);
						});
					}
					else {
						scope.traverseSynTree(child, scope, func);
					}
				}
			}
		}
	}

	/**
	 * Match a given file extension with the configured extensions
	 * @param {string} fileExtension - ".xxx" or "xxx
	 * @returns {boolean}
	 */
	private matchExtension(fileExtension: string): boolean {
		if (Utils.isEmpty(fileExtension) || this.fileFilter.length == 0) return false;
		const matchesFilter = this.fileFilter.find(f => fileExtension.endsWith(f)) !== undefined;
		return matchesFilter;
	}

	/**
	 * Recursively walking a directory structure and collect files
	 * @param dir
	 * @param filelist
	 * @param fileExtension
	 * @returns {Array<string>}
	 */
	public walkSync(dir: string, filelist: Array<string>, fileExtension?: string) {
		let scope = this;
		let files = new Array<string>();
		try {

		}
		catch (e) {
			DinaLogger.error(`Unable to read directory "${ dir }"`, e);
			process.exit(667);
		}

		filelist      = filelist || [];
		fileExtension = fileExtension === undefined ? "" : fileExtension;

		for (let file of files) {
			if (fs.statSync(path.join(dir, file)).isDirectory()) {
				filelist = this.walkSync(path.join(dir, file), filelist, fileExtension);
			}
			else {
				Utils.updateLine(file);
				let tmpExt = path.extname(file);

				if (scope.matchExtension(tmpExt)) {
					let fullFilename = path.join(dir, file);
					filelist.push(fullFilename);
				}
			}
		}

		return filelist;
	}
}
