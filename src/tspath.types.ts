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

export interface ISettings {
	[key: string]: string;
}

export enum jsTarget {
	ES2015 = "ES2015",
	ES2016 = "ES2016",
	ES2017 = "ES2017",
	ES2018 = "ES2018",
	ES2019 = "ES2019",
	ES2020 = "ES2020",
	ES3 = "ES3",
	ES5 = "ES5",
	ES6 = "ES6",
}

export interface ITSPathSettings {
	force: boolean,
	verbose: boolean,
	projectPath: string,
	compactOutput: boolean,
	preserveComments: boolean,
	targetJSVersion: jsTarget
}

export interface ITSConfig {
	outDir: string;
	baseUrl: string;
	removeComments: boolean;
	paths: IPaths;
}

export interface IPaths {
	[index: string]: Array<string>;
}
