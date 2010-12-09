/*
Written by Greg Reimer
Copyright (c) 2010
http://github.com/greim
*/

/*
Replace response from remote server by static file service out of a local (to
hoxy) folder, but only when a match is found. Otherwise serve response from
remote server as normal.

usage: @ghost-server(htdocs)

See if request URL path exists under htdocs. If found, serve that file instead
of one on remote server. If not found, serves file on the remote server as
normal. If plugin is running in request phase, a match will pre-empt request to
server. If in response phase, a match merely replaces response body, but will
use remote server's response headers if status == 200.
*/

var PATH = require('path');
var URL = require('url');
var FS = require('fs');

exports.run = function(api){
	var htdocs = api.arg(0);
	var qi = api.getRequestInfo();
	var si = api.getResponseInfo();
	var pUrl = URL.parse(qi.url);

	FS.stat(htdocs, function(err, hstats){
		if (err) {
			// docroot doesn't exist or we can't read it
			api.notify();
			throw new Error('ghost server: '+err.message);
		} else if (!hstats.isDirectory()) {
			// docroot is not a directory
			api.notify();
			throw new Error('ghost server: '+htdocs+' is not a directory');
		} else {
			var fullPath = PATH.normalize(htdocs + pUrl.pathname);
			if (fullPath.indexOf(htdocs) !== 0) {
				// theoretically should never happen
				api.notify();
				throw new Error('ghost server: bad path: '+htdocs+' => '+fullPath);
			} else {
				FS.stat(fullPath, function(err, stats){
					if (err || stats.isDirectory()) {
						// file to be ghost served doesn't exist or is a directory
						api.notify();
					} else {
						// do ghost service w/ conditional GET
						var etag = '"'+stats.mtime.getTime()+'"';
						var m = qi.headers['if-none-match'];
						var send304 = m === etag;
						if (!m) {
							try{
								m = new Date(qi.headers['if-modified-since']);
								send304 = m.getTime() < stats.mtime.getTime();
							} catch(err) {
								api.notify();
								throw new Error('ghost server: '+err.message);
							}
						}
						if (send304) {
							api.setResponseInfo({
								statusCode:304,
								throttle:0,
								headers:{
									server:'hoxy-ghost-server',
									date:(new Date()).toUTCString(),
									'content-length':0,
									'last-modified':stats.mtime.toUTCString(),
									etag:etag,
								},
								body:[],
							});
							api.notify();
						} else {
							FS.readFile(fullPath, function(err, data){
								if (!err) {
									if (si && si.statusCode === 200) {
										si.body = [data];
									} else {
										api.setResponseInfo({
											statusCode:200,
											throttle:0,
											headers:{
												server:'hoxy-ghost-server',
												date:(new Date()).toUTCString(),
												'last-modified':stats.mtime.toUTCString(),
												etag:etag,
												'content-type':getContentType(fullPath),
												'content-length':data.length,
											},
											body:[data],
										});
									}
								}
								api.notify();
							});
						}
					}
				});
			}
		}
	});
};

// todo: use an actual mime types lib
var ctypes = {
	'.html':'text/html; charset=utf-8',
	'.htm':'text/html; charset=utf-8',
	'.css':'text/css; charset=utf-8',
	'.js':'text/javascript; charset=utf-8',
	'.gif':'image/gif',
	'.png':'image/png',
	'.jpg':'image/jpeg',
	'.jpeg':'image/jpeg',
	'.txt':'text/plain; charset=utf-8',
	'.xml':'application/xml',
	'.xsl':'application/xml',
};
function getContentType(path){
	return ctypes[PATH.extname(path).toLowerCase()] || ctypes['.txt'];
}
