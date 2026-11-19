import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.2.10"
    application
}

kotlin {
    jvmToolchain(17)
    compilerOptions {
        freeCompilerArgs.addAll(
            "-opt-in=org.koitharu.kotatsu.parsers.DirectParsersAccess",
            "-opt-in=org.koitharu.kotatsu.parsers.InternalParsersApi",
        )
    }
}

dependencies {
    implementation(files("libs/kotatsu-parsers.jar"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:5.1.0")
    implementation("com.squareup.okio:okio-jvm:3.16.0")
    implementation("org.json:json:20240303")
    implementation("androidx.collection:collection-jvm:1.5.0")
    implementation("org.jsoup:jsoup:1.21.2")
}

application {
    mainClass.set("kotatsu.MainKt")
}

tasks.register<Jar>("fatJar") {
    group = "build"
    description = "Single runnable jar with the parsers and every dependency inside"
    archiveBaseName.set("kotatsu-desktop")
    archiveVersion.set("")
    manifest { attributes["Main-Class"] = "kotatsu.MainKt" }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from(sourceSets.main.get().output)
    from(configurations.runtimeClasspath.get().filter { it.name.endsWith(".jar") }.map { zipTree(it) }) {
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "module-info.class")
    }
}
