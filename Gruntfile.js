'use strict';

module.exports = function(grunt) {

    // Project configuration.
    grunt.initConfig({
        jshint: {
            all: ['lib/*.js', 'index.js', 'Gruntfile.js', 'server.js'],
            options: {
                jshintrc: '.jshintrc'
            }
        }
    });

    // Load the plugin(s)
    grunt.loadNpmTasks('grunt-contrib-jshint');

    // Tasks
    grunt.registerTask('default', ['jshint']);
};
