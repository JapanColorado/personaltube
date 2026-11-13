plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.chaquo.python")
}

// The app is a Python runtime with the server's dependencies, a WebView for the pages, and a native video player
// (NewPipeExtractor finds the streams, Media3 plays them; see NativePlayer.kt). server.py, static/ and the library
// are not packed in; they are read from the project folder that Syncthing keeps on the phone, so a change made on
// the desktop reaches the phone without a new build.
android {
    namespace = "dev.russell.personaltube"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.russell.personaltube"  // fixed: tooling outside this repository refers to the app by this name
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true  // NewPipeExtractor uses java.nio.file, which Android has only from API 33
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources { excludes += listOf("META-INF/DEPENDENCIES", "META-INF/*.kotlin_module") } }
}

dependencies {
    // 1.9 is the newest Media3 that builds against compileSdk 35
    val media3 = "1.9.4"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-dash:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-session:$media3")
    implementation("com.github.TeamNewPipe:NewPipeExtractor:v0.27.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")
}

chaquopy {
    defaultConfig {
        version = "3.12"
        buildPython("/usr/bin/python3.12")
        pip {
            // FastAPI from before it needed pydantic 2, whose compiled core has no Android build. server.py uses
            // nothing newer.
            install("fastapi==0.99.1")
            install("pydantic==1.10.21")
            install("uvicorn==0.34.0")
            install("numpy")
        }
    }
}
