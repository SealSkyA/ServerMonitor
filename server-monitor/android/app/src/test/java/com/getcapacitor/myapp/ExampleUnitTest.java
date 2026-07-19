package com.servermonitor.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Verifies that the generated Android build configuration uses the app identity.
 */
public class ExampleUnitTest {

    @Test
    public void buildConfigUsesApplicationId() {
        assertEquals("com.servermonitor.app", BuildConfig.APPLICATION_ID);
    }
}
